import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CACHE = path.join(ROOT, ".migration-cache");
export const ORIGIN = "https://www.twincraft.com";
export const UA = "Mozilla/5.0 (compatible; twincraft-site-migration/1.0)";

export async function fetchWithRetry(url, opts = {}, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", ...opts });

      if (res.status >= 500 && n < tries) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (n >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * n));
    }
  }
}

export function cachePathFor(url) {
  const p = new URL(url).pathname.replace(/^\/|\/$/g, "") || "index";

  return path.join(CACHE, "html", `${p.replace(/\//g, "__")}.html`);
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readCached(url) {
  return fs.readFile(cachePathFor(url), "utf8");
}
