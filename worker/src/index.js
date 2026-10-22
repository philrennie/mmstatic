/**
 * markminors-contact – Cloudflare Worker that receives the website contact form
 * and emails it to Mark via Resend.
 *
 * Layers of protection, cheapest first:
 *   1. Method / Origin check – only POSTs from the real site are accepted.
 *   2. Per-IP rate limit (Workers rate limiting binding).
 *   3. Size limit on the request body.
 *   4. Honeypot field ("website") – bots fill it, people never see it.
 *   5. Minimum fill time – forms submitted < 3s after page load are bots.
 *   6. Cloudflare Turnstile token, verified server-side (with hostname + action checks).
 *   7. Strict field validation; header-injection-safe; plain-text email only.
 *
 * The recipient address and API keys are Worker secrets – never in the repo or the page.
 *
 * Env:
 *   ALLOWED_ORIGINS   comma-separated, e.g. "https://www.markminors.co.uk,https://markminors.co.uk"
 *   SITE_URL          where to send no-JS visitors back to, e.g. "https://www.markminors.co.uk"
 *   TURNSTILE_SECRET  (secret)
 *   RESEND_API_KEY    (secret)
 *   TO_EMAIL          (secret) e.g. mark@markminors.co.uk
 *   FROM_EMAIL        e.g. "Mark Minors website <website@markminors.co.uk>" (domain verified in Resend)
 *   CONTACT_LIMITER   optional rate-limit binding
 */

const MAX_BODY_BYTES = 32 * 1024;
const MIN_FILL_MS = 3000;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    const origins = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get("Origin") || "";
    const allowed = origins.includes(origin);
    const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
    const cors = allowed
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
      : { Vary: "Origin" };

    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
    if (!allowed) return new Response("Forbidden", { status: 403 });

    const reply = (ok, status, error) => {
      if (wantsJson) return Response.json(ok ? { ok: true } : { ok: false, error }, { status, headers: cors });
      const site = env.SITE_URL || origin;
      return Response.redirect(`${site}/contact/${ok ? "thanks" : "error"}/`, 303);
    };
    // Bots get a convincing "success" so they don't learn anything.
    const fakeOk = () => reply(true, 200);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.CONTACT_LIMITER) {
      const { success } = await env.CONTACT_LIMITER.limit({ key: ip });
      if (!success) return reply(false, 429, "You've sent a few messages very quickly – please wait a minute and try again.");
    }

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_BODY_BYTES) return reply(false, 413, "That message is too long.");

    let form;
    try {
      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) return reply(false, 413, "That message is too long.");
      form = await new Request(request.url, { method: "POST", headers: request.headers, body: raw }).formData();
    } catch {
      return reply(false, 400, "Sorry, that didn't look like a valid form submission.");
    }
    const get = (k) => (typeof form.get(k) === "string" ? form.get(k).trim() : "");

    // Honeypot
    if (get("website")) return fakeOk();

    // Timing trap (the page stamps the time it was loaded)
    const started = Number(get("started"));
    if (started) {
      const elapsed = Date.now() - started;
      if (elapsed < MIN_FILL_MS) return fakeOk();
      if (elapsed > MAX_FILL_MS) return reply(false, 400, "This page has been open a long time – please refresh it and try again.");
    }

    // Field validation
    const oneLine = (s) => s.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/\s{2,}/g, " ");
    const name = oneLine(get("name"));
    const email = get("email");
    const subject = oneLine(get("subject"));
    const message = get("message").replace(/\r\n?/g, "\n");
    if (!name || name.length > 100) return reply(false, 400, "Please enter your name.");
    if (!EMAIL_RE.test(email) || email.length > 200) return reply(false, 400, "Please enter a valid email address.");
    if (subject.length > 150) return reply(false, 400, "Please shorten the subject.");
    if (message.length < 10 || message.length > 5000) return reply(false, 400, "Please write a message (10–5000 characters).");
    const links = (message.match(/https?:\/\//gi) || []).length;
    if (links > 5) return fakeOk();

    // Turnstile
    const token = get("cf-turnstile-response");
    if (!token) return reply(false, 400, "Please complete the spam check and try again.");
    const verified = await verifyTurnstile(token, ip, env, origins);
    if (!verified) return reply(false, 403, "The spam check failed – please refresh the page and try again.");

    // Send
    const text = [
      `Name:    ${name}`,
      `Email:   ${email}`,
      `Subject: ${subject || "(none)"}`,
      "",
      message,
      "",
      "—",
      `Sent from the contact form on ${origin} at ${new Date().toISOString()}`,
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `contact-${await sha256(token)}`,
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.TO_EMAIL],
        reply_to: email,
        subject: `Website enquiry: ${subject || name}`.slice(0, 200),
        text,
      }),
    });
    if (!res.ok) {
      console.error("Resend error", res.status, await res.text());
      return reply(false, 502, "Sorry, the message couldn't be sent right now. Please email me directly.");
    }
    return reply(true, 200);
  },
};

async function verifyTurnstile(token, ip, env, origins) {
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip !== "unknown") body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!res.ok) return false;
  const out = await res.json();
  if (!out.success) return false;
  // Test keys report hostname "example.com"; only enforce hostname/action with real keys.
  if (out.hostname && out.hostname !== "example.com") {
    const hosts = origins.map((o) => new URL(o).hostname);
    if (!hosts.includes(out.hostname)) return false;
    if (out.action && out.action !== "contact") return false;
  }
  return true;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
