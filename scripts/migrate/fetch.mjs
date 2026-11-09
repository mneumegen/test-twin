// Step 1: fetch and cache every live Products / Learning Lab page.
// Usage: node scripts/migrate/fetch.mjs [--refresh]
// Raw HTML is cached in .migration-cache/html/ so parsing can be re-run offline.
import fs from "node:fs/promises";
import path from "node:path";
import { CACHE, ORIGIN, UA, fetchWithRetry, cachePathFor, exists } from "./lib.mjs";

const refresh = process.argv.includes("--refresh");

async function getText(url) {
  const res = await fetchWithRetry(url);

  return { status: res.status, finalUrl: res.url, text: await res.text() };
}

const sitemap = (await getText(`${ORIGIN}/sitemap.xml`)).text;
const all = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const wanted = all.filter((u) => /\/(products|learning-lab)(\/|$)/.test(new URL(u).pathname));

// Pages that exist live but are not in the sitemap.
const extras = [
  "/learning-lab/tag/formulation",
  "/learning-lab/tag/news-updates",
  "/learning-lab/tag/product-development",
  "/learning-lab/tag/trends-innovation",
  "/learning-lab/tag/regulatory",
  "/learning-lab/author/twincraft",
  "/learning-lab/rss.xml",
].map((p) => ORIGIN + p);

const urls = [...new Set([...wanted, ...extras])].sort();

await fs.mkdir(path.join(CACHE, "html"), { recursive: true });
await fs.writeFile(path.join(CACHE, "urls.json"), JSON.stringify(urls, null, 2));
console.log(
  `sitemap: ${all.length} URLs, migrating ${wanted.length} + ${extras.length} extras = ${urls.length}`
);

const results = [];
let i = 0;

async function worker() {
  while (i < urls.length) {
    const url = urls[i++];
    const file = cachePathFor(url);

    if (!refresh && (await exists(file))) {
      results.push({ url, status: "cached" });
      continue;
    }
    const { status, finalUrl, text } = await getText(url);

    if (status === 200) await fs.writeFile(file, text);
    results.push({ url, status, finalUrl: finalUrl !== url ? finalUrl : undefined });
    await new Promise((r) => setTimeout(r, 250)); // be polite
  }
}
await Promise.all([worker(), worker()]); // 2 concurrent

const bad = results.filter((r) => r.status !== 200 && r.status !== "cached");

await fs.writeFile(path.join(CACHE, "fetch-log.json"), JSON.stringify(results, null, 2));
console.log(`fetched/cached: ${results.length - bad.length}, failed: ${bad.length}`);
for (const b of bad) console.log("  FAIL", b.status, b.url);
void UA;
