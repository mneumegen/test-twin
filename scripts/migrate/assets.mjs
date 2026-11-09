// Step 3: download every referenced HubSpot image (full-size original) into src/assets/images.
// Usage: node scripts/migrate/assets.mjs
// Mirrors the existing convention: https://www.twincraft.com/hubfs/<path> -> src/assets/images/hubfs/<path>
// (path kept URL-encoded, exactly as the existing 500+ migrated images are stored).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE, ROOT, fetchWithRetry, exists } from "./lib.mjs";

const assets = JSON.parse(await fs.readFile(path.join(CACHE, "parsed/assets.json"), "utf8"));

export const localPathFor = (url) => `/src/assets/images${new URL(url).pathname}`;

const manifest = {};
const queue = Object.keys(assets);
let i = 0;
const stats = { downloaded: 0, existing: 0, failed: 0 };

async function worker() {
  while (i < queue.length) {
    const url = queue[i++];
    const rel = localPathFor(url);
    const abs = path.join(ROOT, rel);

    if (await exists(abs)) {
      stats.existing++;
    } else {
      const res = await fetchWithRetry(url);
      const type = res.headers.get("content-type") || "";

      if (res.status !== 200 || !type.startsWith("image/")) {
        stats.failed++;
        manifest[url] = { error: `HTTP ${res.status} ${type}` };
        continue;
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, Buffer.from(await res.arrayBuffer()));
      stats.downloaded++;
      await new Promise((r) => setTimeout(r, 150));
    }
    const buf = await fs.readFile(abs);

    manifest[url] = {
      local: rel,
      bytes: buf.length,
      sha1: crypto.createHash("sha1").update(buf).digest("hex"),
    };
  }
}
await Promise.all([worker(), worker(), worker()]);
await fs.writeFile(
  path.join(CACHE, "parsed/asset-manifest.json"),
  JSON.stringify(manifest, null, 2)
);
console.log(stats, "total", queue.length);
for (const [u, m] of Object.entries(manifest)) if (m.error) console.log("FAIL", m.error, u);
