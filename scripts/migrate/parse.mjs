// Step 2: parse cached HTML into structured JSON (offline).
// Usage: node scripts/migrate/parse.mjs
// Writes .migration-cache/parsed/{products,posts,taxonomy,assets,links,anomalies}.json
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { CACHE, ORIGIN, readCached } from "./lib.mjs";

const urls = JSON.parse(await fs.readFile(path.join(CACHE, "urls.json"), "utf8"));
const out = path.join(CACHE, "parsed");

await fs.mkdir(out, { recursive: true });

const anomalies = [];
const flag = (where, issue, detail) => anomalies.push({ where, issue, detail });
const assets = new Map(); // canonical source URL -> { usedBy: Set, widths: Set }
const links = new Map(); // internal href -> Set(usedBy)

const clean = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const slugOf = (url) => new URL(url, ORIGIN).pathname.replace(/\/$/, "").split("/").pop();

/** Normalise a HubSpot image URL to its full-size original on www.twincraft.com/hubfs. */
export function canonicalAsset(src) {
  if (!src) return null;
  const u = new URL(src.replace(/&amp;/g, "&"), ORIGIN);
  let p = u.pathname;

  p = p.replace(/^\/hs-fs\/hubfs\//, "/hubfs/"); // resized proxy -> original
  p = p.replace(/^\/hub\/\d+\/hubfs\//, "/hubfs/");
  if (!/^\/hubfs\//.test(p)) return null; // not a HubSpot file
  const width = Number(u.searchParams.get("width")) || undefined;

  return { url: `${ORIGIN}${p}`, width };
}
function addAsset(src, usedBy) {
  const a = canonicalAsset(src);

  if (!a) {
    if (src) flag(usedBy, "non-hubfs image", src);
    return null;
  }
  const e = assets.get(a.url) || { usedBy: new Set(), widths: new Set() };

  e.usedBy.add(usedBy);
  if (a.width) e.widths.add(a.width);
  assets.set(a.url, e);
  return a;
}
function addLink(href, usedBy) {
  if (!href) return;
  let u;

  try {
    u = new URL(href.replace(/&amp;/g, "&"), ORIGIN);
  } catch {
    return flag(usedBy, "unparseable link", href);
  }
  const host = u.hostname.replace(/^www\./, "");

  if (host === "twincraft.com" || /hs-sites\.com$/.test(host) || /hubspot/.test(host)) {
    const key = /hubspot|hs-sites/.test(host) ? u.href : u.pathname + u.hash;

    if (!links.has(key)) links.set(key, new Set());
    links.get(key).add(usedBy);
  }
}

// ---------------------------------------------------------------- products
const products = [];
const listing = cheerio.load(await readCached(`${ORIGIN}/products`));

// Featured "Current Innovation Collection" slugs, in order.
const featured = [];
// Featured cards carry their own description (used when the library card has none).
const featuredText = new Map();

listing("h2").each((_, h) => {
  if (clean(listing(h).text()) !== "Current Innovation Collection") return;
  listing(h)
    .closest("section")
    .find('a[href^="/products/"]')
    .each((__, a) => {
      const slug = slugOf(listing(a).attr("href"));
      const text = clean(
        listing(a).closest("[class*=rounded]").find("p, .rich-text").first().text()
      );

      featured.push(slug);
      if (text && !featuredText.has(slug)) featuredText.set(slug, text);
    });
});

const cards = new Map();

listing("#product-list > div[data-formats]").each((i, el) => {
  const $el = listing(el);
  const slug = slugOf($el.find('a[href^="/products/"]').attr("href"));
  const split = (v) =>
    (v || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

  cards.set(slug, {
    order: i + 1,
    cardTitle: clean($el.find("h3").text()),
    summary: clean($el.find("p").text()),
    cardImage: $el.find("img").attr("src"),
    cardImageAlt: $el.find("img").attr("alt") || "",
    formats: split($el.attr("data-formats")),
    useCases: split($el.attr("data-use-cases")),
  });
});

// Taxonomy: format groups are defined in an inline script; use cases are title-cased values.
const script = listing("script")
  .toArray()
  .map((s) => listing(s).html())
  .find((s) => s && s.includes("formatGroups"));
const groupsSrc = script.match(/var formatGroups = (\[[\s\S]*?\]);/)[1];
const formatGroups = Function(`"use strict"; return (${groupsSrc});`)(); // trusted: literal from cached page
const titleCase = (v) =>
  v
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

for (const url of urls.filter((u) => /\/products\/[^/]+$/.test(new URL(u).pathname))) {
  const slug = slugOf(url);

  if (slug === "2") continue; // /products/page/2 pagination
  const $ = cheerio.load(await readCached(url));
  const where = `products/${slug}`;
  const main = $("main");
  const sec = main.find("section").first();
  const title = clean(sec.find("h1").first().text());
  const img = sec.find("img").first().attr("src");
  const field = (label) => {
    const h = sec
      .find("h2.label")
      .filter((_, e) => clean($(e).text()).toLowerCase() === label.toLowerCase());

    return h.length ? h.parent() : null;
  };
  const ingWrap = sec.find(".featured-ingredients-content");
  const ingredients = ingWrap
    .find("li")
    .toArray()
    .map((li) => {
      const $li = $(li);

      $li
        .children("span")
        .first()
        .filter((_, s) => !clean($(s).text()))
        .remove(); // decorative bullet
      return $li.html().trim();
    });
  const libraryBase = field("Library Base") ? clean(field("Library Base").find(".h3").text()) : "";
  const naturallyDerived = field("Naturally Derived")
    ? clean(field("Naturally Derived").find(".h3").text())
    : "";
  const claims = field("PRODUCT CLAIMS & CERTIFICATIONS");
  const claimGroups = [];

  if (claims) {
    claims.find("h3").each((_, h) => {
      const items = $(h)
        .nextUntil("h3", "ul")
        .find("li")
        .toArray()
        .map((li) => clean($(li).find("span").last().text()))
        .filter(Boolean);

      claimGroups.push({ heading: clean($(h).text()), items });
    });
  }
  const card = cards.get(slug);
  const metaDesc = $('meta[name="description"]').attr("content") || "";

  if (!title) flag(where, "missing title");
  if (!img) flag(where, "missing image");
  if (!card) flag(where, "not found on /products listing");
  if (card && card.cardTitle !== title)
    flag(where, "listing title differs from page title", { listing: card.cardTitle, page: title });
  if (card && canonicalAsset(card.cardImage)?.url !== canonicalAsset(img)?.url)
    flag(where, "listing image differs from page image", { listing: card.cardImage, page: img });
  if (!ingredients.length) flag(where, "no featured ingredients");
  for (const ing of ingredients)
    if (!/<strong>/.test(ing)) flag(where, "ingredient without a bold name", ing);
  if (!libraryBase) flag(where, "no library base");
  if (!naturallyDerived) flag(where, "no naturally-derived %");
  if (claimGroups.length !== 1 || claimGroups[0]?.heading !== "Free from")
    flag(where, "unexpected claim groups", claimGroups);
  if (card && !card.useCases.length) flag(where, "no use cases on listing");
  if (card && !card.summary) flag(where, "no summary on listing");
  const otherH2 = sec
    .find("h2")
    .toArray()
    .map((e) => clean($(e).text()))
    .filter(
      (t) =>
        ![
          "Featured Ingredients",
          "Library Base",
          "Naturally Derived",
          "PRODUCT CLAIMS & CERTIFICATIONS",
        ].includes(t)
    );

  if (otherH2.length) flag(where, "unexpected sections on page", otherH2);

  addAsset(img, where);
  if (card && card.cardImage !== img) addAsset(card.cardImage, where);
  sec.find("a[href]").each((_, a) => addLink($(a).attr("href"), where));

  products.push({
    slug,
    title,
    metaDescription: metaDesc,
    image: canonicalAsset(img)?.url,
    imageAlt: card?.cardImageAlt || title,
    summary: card?.summary || featuredText.get(slug) || "",
    summarySource: card?.summary ? "listing" : featuredText.get(slug) ? "featured card" : "none",
    formats: card?.formats || [],
    useCases: card?.useCases || [],
    featured: featured.includes(slug),
    featuredOrder: featured.includes(slug) ? featured.indexOf(slug) + 1 : undefined,
    order: card?.order,
    featuredIngredients: ingredients, // HTML strings, converted to Markdown at import
    libraryBase,
    naturallyDerived,
    freeFrom: claimGroups.find((g) => g.heading === "Free from")?.items || [],
  });
}
for (const slug of cards.keys())
  if (!products.find((p) => p.slug === slug))
    flag(`products/${slug}`, "on listing but no detail page in sitemap");
for (const slug of featured)
  if (!cards.has(slug)) flag(`products/${slug}`, "featured but not in main listing");

const useCaseValues = [...new Set(products.flatMap((p) => p.useCases))].sort();
const formatValues = new Set(products.flatMap((p) => p.formats));
const known = new Set(formatGroups.flatMap((g) => g.items.map((i) => i.value)));

for (const f of formatValues)
  if (!known.has(f)) flag("taxonomy", "format value not in formatGroups", f);
const taxonomy = {
  formatGroups,
  useCases: useCaseValues.map((value) => ({ value, label: titleCase(value) })),
};

// ---------------------------------------------------------------- posts
const posts = [];
const ll = cheerio.load(await readCached(`${ORIGIN}/learning-lab`));
const listingTags = new Map();
const listingOrder = [];
const listingExcerpt = new Map();

ll("#blog-list .blog-post-card").each((_, el) => {
  const $el = ll(el);
  const href = $el.find("a[href]").first().attr("href");
  const slug = href ? slugOf(href) : null;
  const tags = ($el.attr("data-tags") || "").split("|").map(clean).filter(Boolean);

  if (!slug)
    return flag("learning-lab listing", "card without link", clean($el.text()).slice(0, 80));
  if (listingTags.has(slug)) flag(`learning-lab/${slug}`, "duplicate card on listing");
  listingTags.set(slug, tags);
  listingOrder.push(slug);
  listingExcerpt.set(slug, clean($el.find(".blog-post-card__summary").text()));
});

const tagSlug = (t) =>
  t
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

for (const url of urls.filter(
  (u) => /\/learning-lab\/[^/]+$/.test(new URL(u).pathname) && !u.endsWith("rss.xml")
)) {
  const slug = slugOf(url);
  const where = `learning-lab/${slug}`;
  const $ = cheerio.load(await readCached(url));
  let ld = {};

  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).html());

      if (j.datePublished) ld = j;
    } catch {
      flag(where, "bad JSON-LD");
    }
  });
  const article = $("article.blog-post");
  const title = clean(article.find("h1").text());
  const hero =
    article.prev("img").attr("src") || $(".body-container--blog-post img").first().attr("src");
  const bodyEl = article.find("#hs_cos_wrapper_post_body");
  const pageTags = article
    .find(".blog-post__tag-link")
    .toArray()
    .map((e) => clean($(e).text()));
  const tags = listingTags.get(slug) || pageTags;

  if (!title) flag(where, "missing title");
  if (!bodyEl.length) flag(where, "missing body");
  if (!ld.datePublished) flag(where, "missing datePublished");
  if (!hero) flag(where, "missing featured image");
  if (!listingTags.has(slug)) flag(where, "not on /learning-lab listing");
  if (!tags.length) flag(where, "no tags");
  const lc = (a) =>
    a
      .map((t) => t.toLowerCase())
      .sort()
      .join("|");

  if (listingTags.has(slug) && lc(pageTags) !== lc(listingTags.get(slug)))
    flag(where, "tags differ between post and listing", {
      post: pageTags,
      listing: listingTags.get(slug),
    });

  // Inventory body images, embeds, links.
  const inline = [];

  bodyEl.find("img").each((_, img) => {
    const src = $(img).attr("src");
    const a = addAsset(src, where);

    inline.push({
      src,
      width: Number($(img).attr("width")) || a?.width,
      alt: $(img).attr("alt") || "",
    });
  });
  bodyEl
    .find("iframe, video, embed, object, form, script")
    .each((_, e) =>
      flag(
        where,
        `embedded <${e.tagName}> in body`,
        $(e).attr("src") || clean($.html(e)).slice(0, 120)
      )
    );
  bodyEl
    .find(".hs-cta-wrapper, .hs-cta-embed, [class*='hs-cta'], [data-hs-cta]")
    .each((_, e) => flag(where, "HubSpot CTA in body", clean($.html(e)).slice(0, 160)));
  bodyEl.find("a[href]").each((_, a) => addLink($(a).attr("href"), where));
  addAsset(hero, where);

  posts.push({
    slug,
    title,
    metaTitle: clean($("title").text()),
    description: $('meta[name="description"]').attr("content") || "",
    image: canonicalAsset(hero)?.url,
    imageAlt: "",
    ogImage: canonicalAsset($('meta[property="og:image"]').attr("content"))?.url,
    publishedDate: ld.datePublished,
    modifiedDate: ld.dateModified,
    author: ld.author?.name || "Twincraft",
    tags,
    tagSlugs: tags.map(tagSlug),
    listingOrder: listingOrder.indexOf(slug) + 1 || undefined,
    excerpt: listingExcerpt.get(slug) || "",
    inlineImages: inline,
    bodyHtml: bodyEl.html() || "",
  });
}
for (const slug of listingTags.keys())
  if (!posts.find((p) => p.slug === slug))
    flag(`learning-lab/${slug}`, "on listing but not in sitemap");

// Tags: label as shown, slug as used live.
const tagMap = new Map();

for (const p of posts)
  p.tags.forEach((t, i) => tagMap.set(p.tagSlugs[i], tagMap.get(p.tagSlugs[i]) || t));

// ---------------------------------------------------------------- write
const ser = (m) =>
  Object.fromEntries(
    [...m].map(([k, v]) => [
      k,
      v instanceof Set ? [...v] : { ...v, usedBy: [...v.usedBy], widths: [...v.widths] },
    ])
  );

await fs.writeFile(path.join(out, "products.json"), JSON.stringify(products, null, 2));
await fs.writeFile(path.join(out, "posts.json"), JSON.stringify(posts, null, 2));
await fs.writeFile(
  path.join(out, "taxonomy.json"),
  JSON.stringify({ ...taxonomy, tags: Object.fromEntries(tagMap) }, null, 2)
);
await fs.writeFile(path.join(out, "assets.json"), JSON.stringify(ser(assets), null, 2));
await fs.writeFile(path.join(out, "links.json"), JSON.stringify(ser(links), null, 2));
await fs.writeFile(path.join(out, "anomalies.json"), JSON.stringify(anomalies, null, 2));

console.log(
  `products: ${products.length} (listing cards ${cards.size}, featured ${featured.length})`
);
console.log(`posts: ${posts.length} (listing cards ${listingTags.size})`);
console.log(
  `formats: ${formatValues.size}, use cases: ${useCaseValues.length}, tags: ${tagMap.size} ${JSON.stringify(Object.fromEntries(tagMap))}`
);
console.log(
  `assets: ${assets.size}, internal links: ${links.size}, anomalies: ${anomalies.length}`
);
const byIssue = {};

for (const a of anomalies) byIssue[a.issue] = (byIssue[a.issue] || 0) + 1;
console.log(byIssue);
