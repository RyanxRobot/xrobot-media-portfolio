// Runs on Netlify before each deploy (netlify.toml → build.command).
// Writes data/site.json with the date of the commit being deployed, which the footer shows as
// "Site last updated …" (filled in by xr-edit.js). Never fails the deploy.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let updated = "";
try { updated = execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim(); } catch {}
if (!updated) updated = new Date().toISOString();

const info = { updated, commit: (process.env.COMMIT_REF || "").slice(0, 7) };
try {
  writeFileSync("data/site.json", JSON.stringify(info) + "\n");
  console.log("site-info:", info);
} catch (e) {
  console.warn("site-info: couldn't write data/site.json:", e.message);
}
