// Contact form: renders Cloudflare Turnstile, then posts to the contact Worker.
// Without JavaScript the form still posts normally and the Worker redirects
// back to /contact/thanks/ (Turnstile will fail in that case, so no-JS bots get nowhere).
const form = document.getElementById("contact-form");

if (form) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector("button[type=submit]");
  form.elements.started.value = String(Date.now());

  let widgetId;
  const renderTurnstile = () => {
    if (!window.turnstile || widgetId !== undefined) return;
    widgetId = window.turnstile.render("#cf-turnstile", {
      sitekey: form.dataset.sitekey,
      action: "contact",
      theme: "dark",
      appearance: "interaction-only",
    });
  };
  // api.js loads async; poll briefly until it is ready
  const wait = setInterval(() => {
    if (window.turnstile) { clearInterval(wait); renderTurnstile(); }
  }, 200);
  setTimeout(() => clearInterval(wait), 20000);

  const say = (msg, kind = "") => {
    status.textContent = msg;
    status.dataset.kind = kind;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = new FormData(form);
    if (!data.get("cf-turnstile-response")) {
      say("Just a moment – checking you're not a robot…");
      renderTurnstile();
      return;
    }
    button.disabled = true;
    say("Sending…");
    try {
      const res = await fetch(form.action, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        form.reset();
        form.elements.started.value = String(Date.now());
        say("Thanks – your message is on its way. I'll be in touch soon.", "ok");
      } else {
        say(json.error || "Sorry, something went wrong. Please try again or email me directly.", "error");
      }
    } catch {
      say("Sorry, the message couldn't be sent. Please email me directly.", "error");
    } finally {
      button.disabled = false;
      if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);
    }
  });
}
