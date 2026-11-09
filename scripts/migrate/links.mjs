// Step 4: resolve every internal link found in migrated content through the live redirect chain.
// Usage: node scripts/migrate/links.mjs
// Writes .migration-cache/parsed/link-resolution.json: { href: { chain, finalUrl, finalStatus, rewriteTo } }
import fs from "node:fs/promises";
import path from "node:path";
import { CACHE, ORIGIN, UA } from "./lib.mjs";

const links = JSON.parse(await fs.readFile(path.join(CACHE, "parsed/links.json"), "utf8"));

async function resolve(start) {
  const chain = [];
  let url = new URL(start, ORIGIN).href;

  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": UA },
    });

    chain.push({ url, status: res.status });
    const loc = res.headers.get("location");

    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, url).href;
      continue;
    }
    return { chain, finalUrl: url, finalStatus: res.status };
  }
  return { chain, finalUrl: url, finalStatus: "too many redirects" };
}

const out = {};

for (const href of Object.keys(links)) {
  const r = await resolve(href);
  const fu = new URL(r.finalUrl);
  const onSite = fu.hostname === "www.twincraft.com";

  // A trailing-slash-only redirect is canonicalisation; anything else is a real move.
  r.rewriteTo =
    r.finalStatus === 200
      ? (onSite ? fu.pathname.replace(/\/$/, "") || "/" : r.finalUrl) + fu.hash
      : null;
  r.usedBy = links[href];
  out[href] = r;
  await new Promise((res) => setTimeout(res, 150));
}
await fs.writeFile(path.join(CACHE, "parsed/link-resolution.json"), JSON.stringify(out, null, 2));

for (const [href, r] of Object.entries(out)) {
  const hops = r.chain.length - 1;
  const mark = r.finalStatus === 200 ? (hops ? "MOVED" : "ok   ") : "BROKEN";

  console.log(
    `${mark} ${href} ${hops ? `-> ${r.finalUrl}` : ""} ${r.finalStatus !== 200 ? `[${r.finalStatus}] used by ${r.usedBy.join(", ")}` : ""}`
  );
}
