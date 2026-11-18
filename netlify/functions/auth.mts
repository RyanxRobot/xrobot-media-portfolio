// xRobot.media passkey sign-in (POST /api/auth).
//
// The Admin page registers a passkey (needs the publish key, or an existing sign-in) and signs in
// with it. The server checks the passkey's signature against the public key saved at registration,
// then sets a signed, HttpOnly session cookie (see netlify/lib/session.mts) that lasts 12 hours.
// Edit mode and the editor only switch on with a valid session, and /api/publish accepts the
// session instead of the publish key.
//
// Saved passkeys (public keys only, nothing secret) live in Netlify Blobs, store "xr-auth".
// Needs XR_PUBLISH_KEY_HASH (it also signs the cookies).
//
// Actions (JSON body):
//   { action: "status" }                                  → { signedIn, exp?, devices }
//   { action: "check-key" }                 [key]         → { ok } if the publish key is right
//   { action: "register-options", name? }  [key|session]  → { options, token }
//   { action: "register", token, response, name? } [key|session] → saves the passkey and signs in
//   { action: "login-options" }                           → { options, token }
//   { action: "login", token, response }                  → signs in
//   { action: "logout" }                                  → signs out
//   { action: "devices" }                   [session]     → { devices: [...] }
//   { action: "remove-device", id }         [session]     → removes a passkey

import type { Config, Context } from "@netlify/functions";
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  b64u, clearCookie, json, keyOk, publishingConfigured, readSession, sessionCookie, sign, siteOrigin, storage, unb64u, unsign,
  type Device,
} from "../lib/session.mts";

const MAX_DEVICES = 10;
const CHALLENGE_MS = 5 * 60_000;

const publicDevice = (d: Device) => ({ id: d.id, name: d.name, created: d.created, lastUsed: d.lastUsed || null, site: d.rpID });

async function challengeToken(purpose: string, challenge: string, rpID: string, extra: object = {}) {
  return sign({ t: purpose, c: challenge, rp: rpID, exp: Date.now() + CHALLENGE_MS, ...extra });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!publishingConfigured()) return json({ error: "XR_PUBLISH_KEY_HASH isn't set on Netlify yet, so sign-in is off." }, 503);
  const site = siteOrigin(req);
  if (!site) return json({ error: "Sign-in only works from the live site's own address." }, 403);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  const session = await readSession(req);

  try {
    switch (body.action) {
      case "status": {
        const devices = (await storage.get()).filter((d) => d.rpID === site.rpID).length;
        return json({ ok: true, signedIn: !!session, exp: session?.exp || null, devices, site: site.rpID });
      }

      // The footer's hidden sign-in box checks the publish key before sending you to passkey setup.
      case "check-key":
        if (!(await keyOk(req))) return json({ error: "Wrong publish key." }, 401);
        return json({ ok: true });

      case "register-options": {
        if (!session && !(await keyOk(req))) return json({ error: "Wrong publish key." }, 401);
        const all = await storage.get();
        if (all.length >= MAX_DEVICES) return json({ error: `There are already ${MAX_DEVICES} passkeys. Remove one first.` }, 400);
        const name = String(body.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Passkey";
        const options = await generateRegistrationOptions({
          rpName: "xRobot Media", rpID: site.rpID,
          userName: "admin", userDisplayName: "xRobot Admin",
          userID: new TextEncoder().encode("xrobot-admin"),
          attestationType: "none",
          excludeCredentials: all.filter((d) => d.rpID === site.rpID).map((d) => ({ id: d.id, transports: d.transports })),
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        });
        return json({ ok: true, options, token: await challengeToken("reg", options.challenge, site.rpID, { name }) });
      }

      case "register": {
        if (!session && !(await keyOk(req))) return json({ error: "Wrong publish key." }, 401);
        const ch = await unsign(body.token);
        if (!ch || ch.t !== "reg" || ch.rp !== site.rpID) return json({ error: "This setup request expired. Try again." }, 400);
        const v = await verifyRegistrationResponse({
          response: body.response, expectedChallenge: ch.c, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true,
        });
        if (!v.verified) return json({ error: "The passkey couldn't be verified." }, 400);
        const c = v.registrationInfo.credential;
        const all = (await storage.get()).filter((d) => d.id !== c.id);
        if (all.length >= MAX_DEVICES) return json({ error: `There are already ${MAX_DEVICES} passkeys. Remove one first.` }, 400);
        const now = new Date().toISOString();
        const name = String(body.name || ch.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Passkey";
        all.push({ id: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports, rpID: site.rpID, name, created: now, lastUsed: now });
        await storage.set(all);
        const cookie = await sessionCookie(site.rpID, c.id);
        return json({ ok: true, signedIn: true, exp: cookie.exp }, 200, { "set-cookie": cookie.header });
      }

      case "login-options": {
        const mine = (await storage.get()).filter((d) => d.rpID === site.rpID);
        if (!mine.length) return json({ error: "no-devices", detail: "No passkeys are set up for this address yet." }, 404);
        const options = await generateAuthenticationOptions({
          rpID: site.rpID, userVerification: "required",
          allowCredentials: mine.map((d) => ({ id: d.id, transports: d.transports })),
        });
        return json({ ok: true, options, token: await challengeToken("login", options.challenge, site.rpID) });
      }

      case "login": {
        const ch = await unsign(body.token);
        if (!ch || ch.t !== "login" || ch.rp !== site.rpID) return json({ error: "This sign-in request expired. Try again." }, 400);
        const all = await storage.get();
        const dev = all.find((d) => d.id === body.response?.id && d.rpID === site.rpID);
        if (!dev) return json({ error: "That passkey isn't set up for this site." }, 401);
        const v = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: ch.c, expectedOrigin: site.origin, expectedRPID: site.rpID,
          credential: { id: dev.id, publicKey: unb64u(dev.publicKey), counter: dev.counter, transports: dev.transports },
          requireUserVerification: true,
        });
        if (!v.verified) return json({ error: "The passkey couldn't be verified." }, 401);
        dev.counter = v.authenticationInfo.newCounter;
        dev.lastUsed = new Date().toISOString();
        await storage.set(all);
        const cookie = await sessionCookie(site.rpID, dev.id);
        return json({ ok: true, signedIn: true, exp: cookie.exp }, 200, { "set-cookie": cookie.header });
      }

      case "logout":
        return json({ ok: true, signedIn: false }, 200, { "set-cookie": clearCookie() });

      case "devices": {
        if (!session) return json({ error: "Sign in first." }, 401);
        return json({ ok: true, devices: (await storage.get()).map(publicDevice), current: session.dev });
      }

      case "remove-device": {
        if (!session) return json({ error: "Sign in first." }, 401);
        const all = await storage.get();
        const left = all.filter((d) => d.id !== body.id);
        if (left.length === all.length) return json({ error: "That passkey wasn't found." }, 404);
        await storage.set(left);
        // Removing the passkey you're signed in with also signs you out.
        const headers: Record<string, string> = body.id === session.dev ? { "set-cookie": clearCookie() } : {};
        return json({ ok: true, devices: left.map(publicDevice), signedOut: body.id === session.dev }, 200, headers);
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e: any) {
    console.error(e);
    // Verification failures from the library land here (wrong origin, bad signature, etc.).
    const msg = String(e?.message || e);
    return json({ error: "Passkey check failed.", detail: msg.slice(0, 200) }, /Unexpected|verif|challenge|origin|RP ID|signature/i.test(msg) ? 400 : 502);
  }
};

export const config: Config = {
  path: "/api/auth",
  method: ["POST"],
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 30 },
};
