// Unit tests for the contact Worker. Run with `npm test` (Node 20+, no wrangler needed).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const ORIGIN = "https://www.markminors.co.uk";
const env = {
  ALLOWED_ORIGINS: `${ORIGIN},https://markminors.co.uk`,
  SITE_URL: ORIGIN,
  TURNSTILE_SECRET: "secret",
  RESEND_API_KEY: "re_test",
  TO_EMAIL: "mark@example.com",
  FROM_EMAIL: "Site <site@example.com>",
};

let calls;
let turnstileResult;
beforeEach(() => {
  calls = [];
  turnstileResult = { success: true, hostname: "www.markminors.co.uk", action: "contact" };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("turnstile")) return Response.json(turnstileResult);
    if (String(url).includes("resend")) return Response.json({ id: "1" });
    throw new Error("unexpected fetch " + url);
  };
});

const valid = () => ({
  name: "Jane Producer",
  email: "jane@example.com",
  subject: "Shoot next month",
  message: "Hi Mark, are you free to vision mix a gig?",
  website: "",
  started: String(Date.now() - 10_000),
  "cf-turnstile-response": "tok",
});

function req(fields, { origin = ORIGIN, json = true, method = "POST" } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const headers = { Origin: origin, "CF-Connecting-IP": "203.0.113.1" };
  if (json) headers.Accept = "application/json";
  return new Request("https://worker.example/", { method, headers, body: method === "POST" ? body : undefined });
}

const sent = () => calls.filter((c) => c.url.includes("resend"));

test("valid submission sends a plain-text email with reply-to", async () => {
  const res = await worker.fetch(req(valid()), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent().length, 1);
  const payload = JSON.parse(sent()[0].init.body);
  assert.deepEqual(payload.to, ["mark@example.com"]);
  assert.equal(payload.reply_to, "jane@example.com");
  assert.match(payload.text, /vision mix a gig/);
  assert.equal(payload.html, undefined);
});

test("rejects other origins", async () => {
  const res = await worker.fetch(req(valid(), { origin: "https://evil.example" }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("rejects GET", async () => {
  const res = await worker.fetch(req({}, { method: "GET" }), env);
  assert.equal(res.status, 405);
});

test("honeypot silently drops", async () => {
  const res = await worker.fetch(req({ ...valid(), website: "http://spam" }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test("too-fast submissions silently drop", async () => {
  const res = await worker.fetch(req({ ...valid(), started: String(Date.now() - 500) }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test("failed Turnstile is rejected", async () => {
  turnstileResult = { success: false };
  const res = await worker.fetch(req(valid()), env);
  assert.equal(res.status, 403);
  assert.equal(sent().length, 0);
});

test("Turnstile token from another hostname is rejected", async () => {
  turnstileResult = { success: true, hostname: "evil.example", action: "contact" };
  const res = await worker.fetch(req(valid()), env);
  assert.equal(res.status, 403);
});

test("missing token is rejected", async () => {
  const f = valid(); delete f["cf-turnstile-response"];
  const res = await worker.fetch(req(f), env);
  assert.equal(res.status, 400);
});

test("bad email is rejected", async () => {
  const res = await worker.fetch(req({ ...valid(), email: "not-an-email" }), env);
  assert.equal(res.status, 400);
});

test("header injection in subject is flattened", async () => {
  await worker.fetch(req({ ...valid(), subject: "Hi\r\nBcc: victim@example.com" }), env);
  const payload = JSON.parse(sent()[0].init.body);
  assert.ok(!/[\r\n]/.test(payload.subject));
});

test("link-stuffed messages silently drop", async () => {
  const spam = Array.from({ length: 8 }, (_, i) => `https://spam${i}.example`).join(" ");
  const res = await worker.fetch(req({ ...valid(), message: spam }), env);
  assert.equal(res.status, 200);
  assert.equal(sent().length, 0);
});

test("no-JS posts get a 303 redirect", async () => {
  const res = await worker.fetch(req(valid(), { json: false }), env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), `${ORIGIN}/contact/thanks/`);
});

test("rate limiter is honoured", async () => {
  const limited = { ...env, CONTACT_LIMITER: { limit: async () => ({ success: false }) } };
  const res = await worker.fetch(req(valid()), limited);
  assert.equal(res.status, 429);
});

test("CORS preflight from site is allowed", async () => {
  const res = await worker.fetch(new Request("https://worker.example/", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});
