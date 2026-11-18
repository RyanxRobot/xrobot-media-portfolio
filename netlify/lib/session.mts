// Shared sign-in helpers for the publish and auth functions.
//
// Two ways to prove you're the site owner:
//   1. The publish key (header "x-xr-key"), checked against XR_PUBLISH_KEY_HASH.
//   2. A passkey sign-in (netlify/functions/auth.mts), which sets a signed, HttpOnly session cookie.
// The cookie is signed with a key derived from XR_PUBLISH_KEY_HASH, so changing the publish key
// signs every device out.

import { getStore } from "@netlify/blobs";

export const env = (k: string) => (globalThis as any).Netlify?.env.get(k) || "";
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const enc = new TextEncoder();
export const b64u = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sameStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const publishHash = () => env("XR_PUBLISH_KEY_HASH").trim().toLowerCase();
export const publishingConfigured = () => /^[0-9a-f]{64}$/.test(publishHash());

export async function keyOk(req: Request) {
  const key = req.headers.get("x-xr-key") || "";
  if (!key || key.length > 512 || !publishingConfigured()) return false;
  return sameStr(await sha256Hex(key), publishHash());
}

// ---- signing (session cookies and short-lived WebAuthn challenges) ----
async function hmacKey() {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("xr-session-v1:" + publishHash()));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload: object) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return `${body}.${b64u(sig)}`;
}

export async function unsign(token: string): Promise<any | null> {
  if (!publishingConfigured() || typeof token !== "string" || token.length > 4096) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(Buffer.from(unb64u(body)).toString("utf8"));
    if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ---- where requests come from ----
// Passkeys belong to one web address. Allowed: the Netlify address (and its deploy previews),
// xrobot.media, and localhost only when XR_ALLOW_LOCALHOST=1 (tests).
export function siteOrigin(req: Request): { origin: string; rpID: string } | null {
  const origin = req.headers.get("origin") || "";
  let u: URL;
  try { u = new URL(origin); } catch { return null; }
  const host = u.hostname;
  const ok =
    (u.protocol === "https:" && (host === "xrobot-media.netlify.app" || host.endsWith("--xrobot-media.netlify.app") ||
      host === "xrobot.media" || host === "www.xrobot.media")) ||
    (env("XR_ALLOW_LOCALHOST") === "1" && host === "localhost");
  if (!ok) return null;
  // The request must be for the same site it came from.
  try { if (new URL(req.url).hostname !== host && env("XR_ALLOW_LOCALHOST") !== "1") return null; } catch { return null; }
  return { origin: u.origin, rpID: host };
}

// ---- saved passkeys (public keys only) in Netlify Blobs ----
export type Device = { id: string; publicKey: string; counter: number; transports?: string[]; rpID: string; name: string; created: string; lastUsed?: string };
// Tests swap these for an in-memory store.
export const storage: { get: () => Promise<Device[]>; set: (d: Device[]) => Promise<void> } = {
  async get() { return ((await getStore({ name: "xr-auth", consistency: "strong" }).get("devices", { type: "json" })) as Device[]) || []; },
  async set(d) { await getStore({ name: "xr-auth", consistency: "strong" }).setJSON("devices", d); },
};

// ---- session cookie ----
export const SESSION_HOURS = 12;
const COOKIE = "__Host-xr_session";

export function readCookie(req: Request, name = COOKIE) {
  const all = req.headers.get("cookie") || "";
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export async function sessionCookie(rpID: string, device: string) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const token = await sign({ t: "session", rp: rpID, dev: device, exp });
  return { exp, header: `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict` };
}

export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

// A valid session for this site, or null. Cookie-authenticated writes must also come from this site.
export async function readSession(req: Request): Promise<{ exp: number; dev: string; rp: string } | null> {
  const token = readCookie(req);
  if (!token) return null;
  const s = await unsign(token);
  if (!s || s.t !== "session") return null;
  const site = siteOrigin(req);
  if (!site || site.rpID !== s.rp) return null;
  // Removing a passkey on the Admin page ends sign-ins made with it.
  try { if (!(await storage.get()).some((d) => d.id === s.dev)) return null; } catch { return null; }
  return s;
}
