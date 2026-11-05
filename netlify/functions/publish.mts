// xRobot.media on-site editor backend.
// The editor (xr-cms.js) calls POST /api/publish with the publish key in the
// "x-xr-key" header. This function checks the key, then writes files to the
// GitHub repo; Netlify redeploys the site from that commit automatically.
//
// Environment variables (Netlify → Project configuration → Environment variables, scope: Functions):
//   GITHUB_TOKEN   required. Fine-grained token with "Contents: Read and write" on the repo only.
//   GITHUB_REPO    optional, default "RyanxRobot/xrobot-media-portfolio".
//   GITHUB_BRANCH  optional, default "main".
//   XR_PUBLISH_KEY_HASH  required. SHA-256 (hex) of the publish key. This is deliberately NOT the
//                  edit-mode key: that one's hash is public in xr-edit.js, so it could be cracked
//                  offline. Without this variable, publishing stays off.
//
// Every string in published content is checked: script links (javascript:, vbscript:) are refused
// anywhere, and link/image fields must be a relative path, #anchor, http(s):// or mailto: URL.
//
// Actions (JSON body):
//   { action: "check" }                          → { ok: true } when the key is right.
//   { action: "upload", path, data }             → stores one image (base64) as a git blob → { sha }.
//   { action: "commit", message, pages, uploads, base }
//       pages:   { [page]: <content object> }    rewritten as data/<page>.js
//       uploads: [{ path, sha }]                 blobs from earlier "upload" calls
//       base:    { [page]: <sha256 of the JSON the editor started from> }  (conflict check)
//     → { ok: true, commit, hashes }

import type { Config, Context } from "@netlify/functions";

const MAX_IMAGE_BYTES = 4_300_000;
const PAGE_RE = /^[a-z0-9-]{1,40}$/;
// Uploaded images may only land in a folder under assets/ (e.g. assets/photos/street/, assets/video/),
// as plain lowercase-named jpg/webp/png files.
const UPLOAD_RE = /^assets\/(?:[a-z0-9][a-z0-9-]{0,60}\/){1,4}[a-z0-9][a-z0-9-]{0,80}\.(?:jpg|webp|png)$/;

const env = (k: string) => Netlify.env.get(k) || "";
const repo = () => env("GITHUB_REPO") || "RyanxRobot/xrobot-media-portfolio";
const branch = () => env("GITHUB_BRANCH") || "main";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const publishHash = () => env("XR_PUBLISH_KEY_HASH").trim().toLowerCase();

async function keyOk(req: Request) {
  const key = req.headers.get("x-xr-key") || "";
  if (!key || key.length > 512) return false;
  return sameHex(await sha256Hex(key), publishHash());
}

// ---- content safety ----
// Fields that become href/src attributes on the site.
const URL_KEYS = new Set(["link", "href", "altHref", "src", "image", "card", "bg", "thumbImage", "video"]);
const SCRIPT_SCHEME = /^(?:javascript|vbscript|livescript):/i;
const SAFE_URL = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+|#[^\s]*|(?![a-z][a-z0-9+.-]*:)(?!\s*\/\/)[^<>"'`\u0000-\u001f]+)$/i;
// Browsers ignore whitespace and control characters inside a URL scheme ("java\tscript:"), so strip them first.
const squash = (s: string) => s.replace(/[\u0000-\u0020\u007f-\u00a0\u200b-\u200f\u2028\u2029\ufeff]/g, "");

function unsafeContent(value: unknown, path = ""): string | null {
  if (typeof value === "string") {
    const key = path.split(".").pop() || "";
    if (SCRIPT_SCHEME.test(squash(value))) return `${path} contains a script link, which isn't allowed.`;
    if (URL_KEYS.has(key) && value.trim() && !SAFE_URL.test(value.trim()))
      return `${path} must be a page path, #anchor, https:// or mailto: link (got "${value.slice(0, 60)}").`;
    if (value.length > 20000) return `${path} is too long.`;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const bad = unsafeContent(value[i], `${path}[${i}]`); if (bad) return bad; }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { const bad = unsafeContent(v, path ? `${path}.${k}` : k); if (bad) return bad; }
  }
  return null;
}

async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "xrobot-media-editor",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err: any = new Error(`GitHub ${res.status}: ${(body && body.message) || text}`.slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return body;
}

// data/<page>.js is always generated here from JSON, so a publish can only ever write data, never script.
function dataFile(page: string, content: unknown) {
  return (
    `/* xRobot.media content: ${page}. Written by the on-site editor (xr-cms.js) on publish; hand edits are fine, keep it valid JSON after the = sign. */\n` +
    `window.XR_DATA = window.XR_DATA || {};\n` +
    `window.XR_DATA[${JSON.stringify(page)}] = ${JSON.stringify(content, null, 2)};\n`
  );
}

function parseDataFile(text: string) {
  const i = text.indexOf("] = ");
  if (i < 0) return null;
  const body = text.slice(i + 4).trim().replace(/;\s*$/, "");
  try { return JSON.parse(body); } catch { return null; }
}

async function readRepoFile(path: string, ref: string): Promise<string | null> {
  try {
    const f = await gh(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`);
    return Buffer.from(f.content || "", "base64").toString("utf8");
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function upload(body: any) {
  const path = String(body.path || "");
  if (!UPLOAD_RE.test(path)) return json({ error: "That file path isn't allowed." }, 400);
  const data = String(body.data || "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) return json({ error: "Image data must be base64." }, 400);
  if (data.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: "Image is too large (max ~4 MB per file)." }, 413);
  const blob = await gh(`/git/blobs`, { method: "POST", body: JSON.stringify({ content: data, encoding: "base64" }) });
  return json({ ok: true, sha: blob.sha });
}

async function commit(body: any) {
  const pages = body.pages && typeof body.pages === "object" ? body.pages : {};
  const uploads: any[] = Array.isArray(body.uploads) ? body.uploads : [];
  const base = body.base && typeof body.base === "object" ? body.base : {};
  const names = Object.keys(pages);
  if (!names.length && !uploads.length) return json({ error: "Nothing to publish." }, 400);
  if (names.length > 10 || uploads.length > 300) return json({ error: "Too many changes in one publish." }, 400);
  for (const p of names) {
    if (!PAGE_RE.test(p)) return json({ error: `Bad page name: ${p}` }, 400);
    const c = pages[p];
    if (!c || typeof c !== "object" || Array.isArray(c)) return json({ error: `Content for ${p} must be an object.` }, 400);
    const bad = unsafeContent(c, p);
    if (bad) return json({ error: "unsafe", detail: `Not published: ${bad}` }, 400);
  }
  for (const u of uploads) {
    if (!u || !UPLOAD_RE.test(String(u.path)) || !/^[0-9a-f]{40}$/.test(String(u.sha))) return json({ error: "Bad upload entry." }, 400);
  }
  const message = String(body.message || "Update site content").replace(/[\r\n]+/g, " ").slice(0, 120);

  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh(`/git/ref/heads/${branch()}`);
    const headSha = ref.object.sha;
    const head = await gh(`/git/commits/${headSha}`);

    // Conflict check: the page data in the repo must still be what the editor started from.
    const hashes: Record<string, string> = {};
    for (const p of names) {
      const current = await readRepoFile(`data/${p}.js`, headSha);
      if (current !== null && base[p]) {
        const parsed = parseDataFile(current);
        const have = parsed ? await sha256Hex(JSON.stringify(parsed)) : "";
        if (have !== base[p]) {
          return json({ error: "conflict", detail: `data/${p}.js changed since this page loaded (an earlier publish may still be deploying). Reload the page in a minute and redo the edit.` }, 409);
        }
      }
      hashes[p] = await sha256Hex(JSON.stringify(pages[p]));
    }

    const tree = await gh(`/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: head.tree.sha,
        tree: [
          ...names.map((p) => ({ path: `data/${p}.js`, mode: "100644", type: "blob", content: dataFile(p, pages[p]) })),
          ...uploads.map((u) => ({ path: u.path, mode: "100644", type: "blob", sha: u.sha })),
        ],
      }),
    });
    const created = await gh(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: `${message}\n\nPublished from the xrobot.media on-site editor.`, tree: tree.sha, parents: [headSha] }),
    });
    try {
      await gh(`/git/refs/heads/${branch()}`, { method: "PATCH", body: JSON.stringify({ sha: created.sha, force: false }) });
      return json({ ok: true, commit: created.sha, url: created.html_url, hashes });
    } catch (e: any) {
      // Someone pushed in between: rebuild on the new head once.
      if (e.status === 422 && attempt === 0) continue;
      throw e;
    }
  }
  return json({ error: "The repo kept changing during publish. Try again." }, 409);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  if (!/^[0-9a-f]{64}$/.test(publishHash())) return json({ error: "XR_PUBLISH_KEY_HASH isn't set on Netlify yet, so publishing is off." }, 503);
  if (!(await keyOk(req))) return json({ error: "Wrong publish key." }, 401);
  if (!env("GITHUB_TOKEN")) return json({ error: "GITHUB_TOKEN isn't set on Netlify yet, so publishing is off." }, 503);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  try {
    if (body.action === "check") return json({ ok: true, repo: repo(), branch: branch() });
    if (body.action === "upload") return await upload(body);
    if (body.action === "commit") return await commit(body);
    return json({ error: "Unknown action." }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: e.message || "Publish failed." }, 502);
  }
};

export const config: Config = {
  path: "/api/publish",
  method: ["POST"],
  // Slows down key guessing.
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 40 },
};
