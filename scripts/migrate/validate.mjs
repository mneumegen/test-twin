// Step 6: validate the local build (dist/) against the cached live pages.
// Usage: npm run build && node scripts/migrate/validate.mjs
// Writes .migration-cache/validation-report.json and prints a pass/fail summary.
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { CACHE, ORIGIN, ROOT, readCached } from "./lib.mjs";

const DIST = path.join(ROOT, "dist");
const urls = JSON.parse(await fs.readFile(path.join(CACHE, "urls.json"), "utf8"));
const routing = JSON.parse(await fs.readFile(path.join(ROOT, ".cloudcannon/routing.json"), "utf8"));
const redirectFrom = routing.routes.filter((r) => r.status === 301).map((r) => new RegExp(r.from));

const norm = (s) =>
  (s || "")
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const distFile = (p) => {
  const clean = p.replace(/\/$/, "");

  if (clean === "") return path.join(DIST, "index.html");
  if (/\.\w+$/.test(clean)) return path.join(DIST, clean);
  return path.join(DIST, `${clean}.html`);
};
const exists = (f) =>
  fs.access(f).then(
    () => true,
    () => false
  );
const loadDist = async (p) => cheerio.load(await fs.readFile(distFile(p), "utf8"));
// Images were renamed to web-safe names (see rename-encoded-assets.mjs), and large PNG photos were
// converted to JPEG (see optimize-images.mjs), so compare both sides in that form.
const safeName = (name) => {
  const ext = path.extname(name);

  return (
    name
      .slice(0, name.length - ext.length)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      // collision suffix added by the rename ("After-Sun-Serum-Stick-2.png")
      .replace(/-\d+$/, "") + ext.toLowerCase().replace(/^\.(png|jpeg)$/, ".jpg")
  );
};
const decodePath = (src) => decodeURIComponent(new URL(src, ORIGIN).pathname.split("/").pop());

const checks = [];

function check(area, name, pass, detail) {
  checks.push({ area, name, pass: !!pass, detail });
}

// ------------------------------------------------------------ 1. coverage
for (const url of urls) {
  const p = new URL(url).pathname;
  const ok = (await exists(distFile(p))) || redirectFrom.some((re) => re.test(p));

  check("coverage", p, ok, ok ? undefined : "no page or redirect");
}
// Static pages from the live sitemap (already migrated before this work).
const sitemap = await fs.readFile(path.join(CACHE, "html/index.html"), "utf8").catch(() => "");

void sitemap;

// ------------------------------------------------------------ 2. products
const liveListing = cheerio.load(await readCached(`${ORIGIN}/products`));
const localListing = await loadDist("/products");
const liveCards = new Map();

liveListing("#product-list > div[data-formats]").each((_, el) => {
  const $el = liveListing(el);
  const slug = $el.find('a[href^="/products/"]').attr("href").split("/").pop();

  liveCards.set(slug, {
    summary: norm($el.find("p").text()),
    formats: ($el.attr("data-formats") || "").split("|").filter(Boolean).sort().join("|"),
    useCases: ($el.attr("data-use-cases") || "").split("|").filter(Boolean).sort().join("|"),
  });
});
// Featured cards carry their own description; it fills in when the library card has none.
const liveFeaturedText = new Map();

liveListing("h2").each((_, h) => {
  if (norm(liveListing(h).text()) !== "Current Innovation Collection") return;
  liveListing(h)
    .closest("section")
    .find('a[href^="/products/"]')
    .each((__, a) => {
      const slug = liveListing(a).attr("href").split("/").pop();
      const text = norm(
        liveListing(a).closest("[class*=rounded]").find("p, .rich-text").first().text()
      );

      if (text && !liveFeaturedText.has(slug)) liveFeaturedText.set(slug, text);
    });
});
const localCards = new Map();

localListing(".product-library--all [data-product]").each((_, el) => {
  const $el = localListing(el);
  const slug = $el.find("a[href^='/products/']").attr("href").split("/").pop();

  localCards.set(slug, {
    summary: norm($el.find(".product-card__summary").first().text()),
    formats: ($el.attr("data-formats") || "").split("|").filter(Boolean).sort().join("|"),
    useCases: ($el.attr("data-use-cases") || "").split("|").filter(Boolean).sort().join("|"),
  });
});
check(
  "products",
  "listing count",
  liveCards.size === localCards.size,
  `${liveCards.size} live / ${localCards.size} local`
);

for (const url of urls.filter((u) => /\/products\/[^/]+$/.test(new URL(u).pathname))) {
  const slug = url.split("/").pop();

  if (slug === "2") continue;
  const live = cheerio.load(await readCached(url));
  const ls = live("main section").first();
  const local = await loadDist(`/products/${slug}`);
  const lo = local(".product-detail");
  const liveField = (label) =>
    norm(
      ls
        .find("h2.label")
        .filter((_, e) => norm(live(e).text()).toLowerCase() === label.toLowerCase())
        .parent()
        .find(".h3")
        .text()
    );
  const localField = (label) =>
    norm(
      lo
        .find(".product-detail__label")
        .filter((_, e) => norm(local(e).text()).toLowerCase() === label.toLowerCase())
        .next(".product-detail__value")
        .text()
    );
  const diffs = [];
  const cmp = (field, a, b) => a !== b && diffs.push({ field, live: a, local: b });

  cmp("title", norm(ls.find("h1").text()), norm(lo.find("h1").text()));
  const productSource = await fs.readFile(
    path.join(ROOT, `src/content/products/${slug}.md`),
    "utf8"
  );

  cmp(
    "image file",
    safeName(decodePath(ls.find("img").first().attr("src"))),
    // local optimized images are renamed: compare against the source path in content
    safeName(decodePath(productSource.match(/^image: (.+)$/m)[1].trim()))
  );
  cmp(
    "ingredients",
    ls
      .find(".featured-ingredients-content li")
      .map((_, li) => norm(live(li).text()))
      .get()
      .join(" | "),
    lo
      .find(".product-detail__list--ingredients li")
      .map((_, li) => norm(local(li).text()))
      .get()
      .join(" | ")
  );
  cmp("library base", liveField("Library Base"), localField("Library Base"));
  cmp("naturally derived", liveField("Naturally Derived"), localField("Naturally Derived"));
  cmp(
    "free from",
    ls
      .find("ul li")
      .filter((_, li) => !live(li).closest(".featured-ingredients-content").length)
      .map((_, li) => norm(live(li).find("span").last().text()))
      .get()
      .join(" | "),
    lo
      .find(".product-detail__list--claims li")
      .map((_, li) => norm(local(li).text()))
      .get()
      .join(" | ")
  );
  const lc = liveCards.get(slug);
  const kc = localCards.get(slug);

  if (!kc) diffs.push({ field: "listing card", live: "present", local: "missing" });
  else {
    cmp("listing summary", lc.summary || liveFeaturedText.get(slug) || "", kc.summary);
    cmp("formats", lc.formats, kc.formats);
    cmp("use cases", lc.useCases, kc.useCases);
  }
  check("products", slug, !diffs.length, diffs.length ? diffs : undefined);
}

// Filter counts.
const tally = (cards, key) => {
  const t = {};

  for (const c of cards.values())
    for (const v of c[key].split("|").filter(Boolean)) t[v] = (t[v] || 0) + 1;
  return JSON.stringify(Object.entries(t).sort());
};

check(
  "products",
  "format filter counts",
  tally(liveCards, "formats") === tally(localCards, "formats")
);
check(
  "products",
  "use-case filter counts",
  tally(liveCards, "useCases") === tally(localCards, "useCases")
);
const liveFeatured = [];

liveListing("h2").each((_, h) => {
  if (norm(liveListing(h).text()) === "Current Innovation Collection")
    liveListing(h)
      .closest("section")
      .find('a[href^="/products/"]')
      .each((__, a) => liveFeatured.push(liveListing(a).attr("href").split("/").pop()));
});
const localFeatured = localListing(".product-library--featured")
  .find("a[href^='/products/']")
  .map((_, a) => localListing(a).attr("href").split("/").pop())
  .get();

check(
  "products",
  "featured collection",
  [...new Set(liveFeatured)].join() === [...new Set(localFeatured)].join(),
  {
    live: [...new Set(liveFeatured)],
    local: [...new Set(localFeatured)],
  }
);

// ------------------------------------------------------------ 3. posts
const words = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$&'.-]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

function similarity(a, b) {
  // Multiset word overlap (order-insensitive), robust to whitespace/markup differences.
  const count = (arr) => arr.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  let common = 0;

  for (const [w, n] of ca) common += Math.min(n, cb.get(w) || 0);
  return common / Math.max(a.length, b.length, 1);
}
function firstDivergence(a, b) {
  let i = 0;

  while (i < a.length && a[i] === b[i]) i++;
  return i < Math.max(a.length, b.length)
    ? {
        at: i,
        live: a.slice(Math.max(0, i - 5), i + 12).join(" "),
        local: b.slice(Math.max(0, i - 5), i + 12).join(" "),
      }
    : null;
}
const liveLL = cheerio.load(await readCached(`${ORIGIN}/learning-lab`));
const liveTagsBySlug = new Map();

liveLL("#blog-list .blog-post-card").each((_, el) => {
  const slug = liveLL(el).find("a[href]").first().attr("href").split("/").pop();

  liveTagsBySlug.set(
    slug,
    (liveLL(el).attr("data-tags") || "")
      .split("|")
      .map((t) => norm(t).toLowerCase())
      .filter(Boolean)
      .sort()
      .join("|")
  );
});

const bodyStats = [];

for (const url of urls.filter(
  (u) => /\/learning-lab\/[^/]+$/.test(new URL(u).pathname) && !u.endsWith("rss.xml")
)) {
  const slug = url.split("/").pop();
  const live = cheerio.load(await readCached(url));
  const local = await loadDist(`/learning-lab/${slug}`);
  const diffs = [];
  const cmp = (field, a, b) => a !== b && diffs.push({ field, live: a, local: b });

  cmp("title", norm(live("article h1").text()), norm(local("article h1").text()));
  cmp(
    "meta description",
    norm(live('meta[name="description"]').attr("content")),
    norm(local('meta[name="description"]').attr("content"))
  );
  let ld = {};

  live('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse(live(s).html());

      if (j.datePublished) ld = j;
    } catch {
      /* ignore */
    }
  });
  cmp(
    "published date",
    ld.datePublished?.slice(0, 10),
    local("article time").attr("datetime")?.slice(0, 10)
  );
  cmp(
    "tags",
    liveTagsBySlug.get(slug),
    local(".article__tags a")
      .map((_, a) => norm(local(a).text()).toLowerCase())
      .get()
      .sort()
      .join("|")
  );
  cmp("og:type", "article", local('meta[property="og:type"]').attr("content"));

  // Pad block boundaries so adjacent cells/headings don't glue words together in .text().
  const spaced = (html) =>
    cheerio.load(
      `<div id="x">${(html || "").replace(/<\/(td|th|p|li|h[1-6]|div|tr|figure|br)>|<br\s*\/?>/g, "$& ")}</div>`
    )("#x");
  const liveBody = spaced(live("#hs_cos_wrapper_post_body").html());

  liveBody.find("script, style, .hs-cta-wrapper").remove();
  const localBody = spaced(local(".article__body").html());

  localBody
    .find('a[href="/contact-us"]')
    .filter((_, a) => /contact our sales team/i.test(cheerio.load(a).text()))
    .remove();
  const lw = words(liveBody.text());
  const kw = words(localBody.text());
  const sim = similarity(lw, kw);

  bodyStats.push(sim);
  if (sim < 0.995)
    diffs.push({
      field: "body text",
      similarity: Number(sim.toFixed(4)),
      ...firstDivergence(lw, kw),
    });
  const visibleEntities = localBody.text().match(/&(?:gt|lt|amp|quot|#\d+);|\\[<>{}&*_]/g);

  if (visibleEntities)
    diffs.push({ field: "escaped characters visible as text", found: visibleEntities });
  const liveImgs = liveBody.find("img").length;
  const localImgs = localBody.find(".post-image").length;

  cmp("inline images", liveImgs, localImgs);
  const liveTables = liveBody.find("table").length;

  cmp("tables", liveTables, localBody.find("table").length);
  check("posts", slug, !diffs.length, diffs.length ? diffs : undefined);
}

// Tag counts: live listing vs local tag pages.
const tagsJson = JSON.parse(
  await fs.readFile(path.join(ROOT, "src/data/learningLabTags.json"), "utf8")
);

for (const t of tagsJson) {
  const liveCount = [...liveTagsBySlug.values()].filter((v) =>
    v.split("|").includes(t.label.toLowerCase())
  ).length;
  const $t = await loadDist(`/learning-lab/tag/${t.slug}`);
  const localCount = $t(".post-list__grid > li").length;

  check(
    "posts",
    `tag page: ${t.slug}`,
    liveCount === localCount,
    `${liveCount} live / ${localCount} local`
  );
}
const $ll = await loadDist("/learning-lab");

check(
  "posts",
  "index lists every article",
  $ll(".post-list").last().find(".post-list__grid > li").length === liveTagsBySlug.size
);

// ------------------------------------------------------------ 4. assets, links, SEO across dist
const htmlFiles = [];

(async function walk() {})();
async function collect(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);

    if (e.isDirectory()) await collect(p);
    else if (e.name.endsWith(".html")) htmlFiles.push(p);
  }
}
await collect(DIST);
const remoteHubspot = [];
const broken = new Map();
const missingImg = new Set();

for (const f of htmlFiles) {
  const html = await fs.readFile(f, "utf8");
  const page = `/${path
    .relative(DIST, f)
    .replace(/\.html$/, "")
    .replace(/(^|\/)index$/, "")}`;

  for (const m of html.matchAll(
    /(?:src|href|srcset|content)="([^"]*(?:hubfs|hs-fs|hubspot\.com|hs-sites\.com)[^"]*)"/g
  ))
    remoteHubspot.push({ page, url: m[1] });
  const $ = cheerio.load(html);

  $("a[href]").each((_, a) => {
    let href = $(a).attr("href");

    // Absolute links to the site itself are internal once this build is live.
    href = href.replace(/^https?:\/\/(www\.)?twincraft\.com(?=\/|$)/, "") || "/";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    const p = href.split("#")[0].split("?")[0];

    if (!p) return;
    (broken.get(p) || broken.set(p, new Set()).get(p)).add(page);
  });
  $("img[src], source[srcset]").each((_, el) => {
    const src = ($(el).attr("src") || $(el).attr("srcset").split(/[ ,]/)[0]).split("?")[0];

    if (src.startsWith("/")) missingImg.add(src);
  });
}
const brokenLinks = [];

for (const [p, pages] of broken) {
  const ok = (await exists(distFile(decodeURI(p)))) || redirectFrom.some((re) => re.test(p));

  if (!ok) brokenLinks.push({ href: p, pages: [...pages].slice(0, 5), count: pages.size });
}
const missingImages = [];

for (const src of missingImg)
  if (!(await exists(path.join(DIST, decodeURI(src))))) missingImages.push(src);
check(
  "assets",
  "no HubSpot-hosted URLs in built pages",
  !remoteHubspot.length,
  remoteHubspot.slice(0, 20)
);
check("assets", "every <img>/<source> resolves", !missingImages.length, missingImages.slice(0, 20));
check("links", "no broken internal links", !brokenLinks.length, brokenLinks);

const sitemapXml = await fs.readFile(path.join(DIST, "sitemap-0.xml"), "utf8");
const inSitemap = new Set(
  [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    new URL(m[1]).pathname.replace(/\/$/, "")
  )
);
const notInSitemap = urls
  .map((u) => new URL(u).pathname.replace(/\/$/, ""))
  .filter((p) => !p.endsWith("rss.xml") && p !== "/products/page/2" && !inSitemap.has(p));

check(
  "seo",
  "sitemap includes every migrated URL",
  !notInSitemap.length,
  notInSitemap.slice(0, 20)
);
const rssXml = await fs.readFile(path.join(DIST, "learning-lab/rss.xml"), "utf8");

check(
  "seo",
  "RSS feed lists every article",
  (rssXml.match(/<item>/g) || []).length === liveTagsBySlug.size
);
const trailing = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1])
  .filter(
    (u) =>
      /[^/]\/$/.test(`${new URL(u).pathname}x`) && u.endsWith("/") && new URL(u).pathname !== "/"
  );

check(
  "seo",
  "sitemap URLs have no trailing slash (matches live)",
  !trailing.length,
  trailing.slice(0, 10)
);

// ------------------------------------------------------------ report
const byArea = {};

for (const c of checks) {
  byArea[c.area] ||= { pass: 0, fail: 0 };
  byArea[c.area][c.pass ? "pass" : "fail"]++;
}
const avg = bodyStats.reduce((a, b) => a + b, 0) / bodyStats.length;
const report = {
  generated: new Date().toISOString(),
  summary: byArea,
  postBodySimilarity: {
    average: Number(avg.toFixed(4)),
    min: Number(Math.min(...bodyStats).toFixed(4)),
  },
  failures: checks.filter((c) => !c.pass),
  checks,
};

await fs.writeFile(path.join(CACHE, "validation-report.json"), JSON.stringify(report, null, 2));
console.log(byArea);
console.log("post body similarity:", report.postBodySimilarity);
for (const f of report.failures)
  console.log("FAIL", f.area, f.name, JSON.stringify(f.detail ?? "").slice(0, 400));
