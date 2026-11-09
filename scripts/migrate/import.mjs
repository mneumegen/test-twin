// Step 5: write parsed data into the site as content collections.
// Usage: node scripts/migrate/import.mjs
// Outputs:
//   src/content/products/<slug>.md          (data-only frontmatter)
//   src/content/learning-lab/<slug>.mdx     (frontmatter + MDX body)
//   src/data/productTaxonomy.json, src/data/learningLabTags.json
//   .migration-cache/parsed/redirects.json, link-report.json
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import YAML from "yaml";
import { CACHE, ROOT, ORIGIN } from "./lib.mjs";

const read = async (f) => JSON.parse(await fs.readFile(path.join(CACHE, "parsed", f), "utf8"));
const products = await read("products.json");
const posts = await read("posts.json");
const taxonomy = await read("taxonomy.json");
const manifest = await read("asset-manifest.json");
const resolution = await read("link-resolution.json");

// Topic icons used by the live /learning-lab filter buttons.
const TAG_ICONS = {
  formulation: "formulation-2.png",
  "news-updates": "news.png",
  "product-development": "pd.png",
  regulatory: "regulatory.png",
  "trends-innovation": "trends.png",
};

// "Featured Articles" on the live /learning-lab index.
const llHtml = await fs.readFile(path.join(CACHE, "html/learning-lab.html"), "utf8");
const FEATURED_POSTS = [
  ...new Set(
    [
      ...llHtml.matchAll(
        /class="featured-posts__title-link"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="featured-posts__title-link"/g
      ),
    ].map((m) => (m[1] || m[2]).split("/").pop())
  ),
];

if (FEATURED_POSTS.length !== 2)
  throw new Error(`expected 2 featured posts, got ${FEATURED_POSTS.length}`);

// Authors: keep the live author-page slug (e.g. /learning-lab/author/niamhoconnor).
const authors = new Map(); // slug -> name

async function authorFor(post) {
  const html = await fs.readFile(path.join(CACHE, `html/learning-lab__${post.slug}.html`), "utf8");
  const url = (html.match(/"author"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/) || [])[1];
  const slug = url ? url.split("/").pop() : "twincraft";

  authors.set(slug, post.author || "Twincraft");
  return slug;
}

const postSlugs = new Set(posts.map((p) => p.slug));
const productSlugs = new Set(products.map((p) => p.slug));

// ------------------------------------------------------------- link decisions
// Old URLs whose live redirect is broken but whose content still exists under a new slug.
const MANUAL = {
  "/twincraft-rspo": "/learning-lab/rspo-claims-for-bar-soap-skincare-deodorant",
  "/sustainable-palm-oil-rspo": "/learning-lab/rspo-claims-for-bar-soap-skincare-deodorant",
  "/twincraft-skincare-blog/prism-approach-to-stopping-body-odor":
    "/learning-lab/prism-how-to-stop-body-odor-at-the-source",
  "/twincraft-skincare-blog/ahas-bhas-phas-chemical-exfoliation-skincare":
    "/learning-lab/ahas-bhas-phas-trending-chemical-exfoliation-in-skincare",
  "/twincraft-skincare-blog/expanding-capabilities-coconut-soap-base":
    "/learning-lab/expanding-our-capabilities-with-coconut-soap-base",
  "/twincraft-skincare-blog/consider-shampoo-bars-for-convenient-cleansing-03-19-18":
    "/learning-lab/consider-shampoo-bars-for-convenient-cleansing",
  "https://cta-redirect.hubspot.com/cta/redirect/3809816/fe3cabce-cb98-469c-9d1d-f8c6a170d6fc":
    "/contact-us",
};
const linkReport = { rewritten: {}, unlinked: {}, unchanged: {} };
const redirects = new Map(); // from -> to

function decide(href) {
  if (MANUAL[href]) return { to: MANUAL[href], why: "manual match" };
  let m = href.match(/^\/product\/([^/#?]+)/);

  if (m && productSlugs.has(m[1])) return { to: `/products/${m[1]}`, why: "old /product/ path" };
  m = href.match(/^\/twincraft-skincare-blog\/([^/#?]+)/);
  if (m && postSlugs.has(m[1]))
    return { to: `/learning-lab/${m[1]}`, why: "old blog path, same slug" };
  const r = resolution[href];

  if (r?.rewriteTo)
    return { to: r.rewriteTo, why: r.chain.length > 1 ? "followed live redirect" : "ok" };
  return { to: null, why: `broken on live site (${r?.finalStatus ?? "unresolved"})` };
}
function rewriteHref(raw, usedBy) {
  const u = new URL(raw.replace(/&amp;/g, "&"), ORIGIN);
  const host = u.hostname.replace(/^www\./, "");
  const isInternal = host === "twincraft.com";
  const key = isInternal ? u.pathname + u.hash : u.href;

  if (!isInternal && !/hubspot|hs-sites/.test(host)) return raw; // external: untouched
  const { to, why } = decide(key) || {};

  if (to === null) {
    (linkReport.unlinked[key] ||= { why, usedBy: [] }).usedBy.push(usedBy);
    return null;
  }
  const target = to.startsWith("http") ? to : to.replace(/\/$/, "") || "/";

  if (target !== key.replace(/\/$/, "")) {
    (linkReport.rewritten[key] ||= { to: target, why, usedBy: [] }).usedBy.push(usedBy);
    if (isInternal) redirects.set(u.pathname.replace(/\/$/, ""), target.split("#")[0]);
  } else (linkReport.unchanged[key] ||= []).push(usedBy);
  return target;
}

// ------------------------------------------------------------- markdown
const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "*",
  codeBlockStyle: "fenced",
});

td.use(gfm);
td.remove(["script", "style", "noscript"]);
// MDX treats { } < as syntax: escape them in text.
const baseEscape = td.escape.bind(td);

td.escape = (s) =>
  baseEscape(s)
    .replace(/[{}]/g, (c) => `\\${c}`)
    // Turndown may already have backslash-escaped these; replace the whole escape with one entity.
    .replace(/\\?</g, "&lt;")
    .replace(/\\?>/g, "&gt;");
// Images are swapped for text tokens before conversion (Turndown drops text-less elements)
// and replaced with <PostImage/> afterwards.
const IMG_TOKEN = (i) => `MDXIMAGETOKEN${i}END`;

/** HubSpot often splits one bold/italic run into adjacent tags, which Markdown can't express. */
const mergeRuns = (html) =>
  html
    .replace(/<(strong|b|em|i)>([\s:;,.]*)<\/\1>/g, "$2") // emphasis around punctuation only
    .replace(/<\/(strong|b|em|i)>(\s*)<\1>/g, "$2");

const mdxAttr = (v) => JSON.stringify(v);

function localImage(src, where) {
  const u = new URL(src.replace(/&amp;/g, "&"), ORIGIN);
  const p = u.pathname
    .replace(/^\/hs-fs\/hubfs\//, "/hubfs/")
    .replace(/^\/hub\/\d+\/hubfs\//, "/hubfs/");
  const m = manifest[`${ORIGIN}${p}`];

  if (!m?.local) throw new Error(`${where}: no local asset for ${src}`);
  return m.local;
}

function bodyToMdx(post) {
  const $ = cheerio.load(`<div id="root">${mergeRuns(post.bodyHtml)}</div>`, null, false);
  const root = $("#root");

  root.find("script, style, noscript").remove();
  root
    .contents()
    .filter((_, n) => n.type === "comment")
    .remove();
  root
    .find("*")
    .contents()
    .filter((_, n) => n.type === "comment")
    .remove();

  // HubSpot CTA -> plain link to its destination.
  root.find(".hs-cta-wrapper").each((_, el) => {
    const $el = $(el);
    const href = $el.find("a[href]").attr("href");
    const label = $el.find("img").attr("alt") || "Contact our sales team";
    const target = rewriteHref(href, post.slug) || "/contact-us";
    const text = label.charAt(0) + label.slice(1).toLowerCase();

    $el.replaceWith(`<p><a href="${target}">${text}</a></p>`);
  });

  const images = [];

  // Images -> <PostImage/>, hoisted out of their paragraph so markup stays valid.
  root.find("img").each((_, img) => {
    const $img = $(img);
    const style = $img.attr("style") || "";
    const align = /float:\s*left/.test(style)
      ? "left"
      : /float:\s*right/.test(style)
        ? "right"
        : /margin[^;]*auto|display:\s*block/.test(style)
          ? "center"
          : undefined;
    const width =
      Number($img.attr("width")) ||
      Number((style.match(/(?:^|;|\s)width:\s*(\d+)px/) || [])[1]) ||
      undefined;
    const $a = $img.parent("a");
    let link;

    if ($a.length && $a.contents().length === 1)
      link = rewriteHref($a.attr("href"), post.slug) || undefined;
    const props = [
      `source=${mdxAttr(localImage($img.attr("src"), post.slug))}`,
      `alt=${mdxAttr($img.attr("alt") || "")}`,
      width ? `width={${width}}` : null,
      align ? `align=${mdxAttr(align)}` : null,
      link ? `link=${mdxAttr(link)}` : null,
    ].filter(Boolean);

    images.push(`<PostImage ${props.join(" ")} />`);
    const node = $("<p></p>").text(IMG_TOKEN(images.length - 1));
    const target = $a.length && $a.contents().length === 1 ? $a : $img;
    // Hoist to just before the top-level block that contains it (tables keep images in place).
    const block = target
      .parents()
      .filter((_, e) => e.parent && $(e.parent).is("#root"))
      .first();

    if (block.length && !block.is("table") && !target.parents("table").length) {
      block.before(node);
      target.remove();
      if (!block.text().trim() && !block.find("img, iframe").length) block.remove();
    } else target.replaceWith(node);
  });

  // Links: rewrite or unlink.
  root.find("a[href]").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href");

    if (/^(mailto:|tel:|#)/.test(href)) return;
    const to = rewriteHref(href, post.slug);

    if (to === null) $a.replaceWith($a.contents());
    else $a.attr("href", to);
  });

  // HubSpot rich-text noise.
  root.find("span").each((_, s) => $(s).replaceWith($(s).contents()));
  root.find("[style]").removeAttr("style");
  // Layout tables from the HubSpot editor: keep structure, drop presentational attributes.
  root.find("table, tbody, thead, tr, td, th").each((_, e) => {
    for (const name of Object.keys(e.attribs || {})) $(e).removeAttr(name);
  });

  let md = td.turndown(root.html());

  md = md
    .replace(/MDXIMAGETOKEN(\d+)END/g, (_, i) => images[Number(i)])
    .replace(/<br\s*>/g, "<br />");
  if (/MDXIMAGETOKEN/.test(md)) throw new Error(`${post.slug}: unreplaced image token`);
  md = md
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return `${md}\n`;
}

const fm = (data) => `---\n${YAML.stringify(data, { lineWidth: 0 }).trim()}\n---\n`;
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length && false)
    )
  );

// ------------------------------------------------------------- products
const productsDir = path.join(ROOT, "src/content/products");

await fs.mkdir(productsDir, { recursive: true });
for (const p of products) {
  const ingredients = p.featuredIngredients
    .map((html) => mergeRuns(html))
    .map((html) => td.turndown(html).replace(/\n+/g, " ").trim());
  const data = clean({
    title: p.title,
    summary: p.summary,
    image: manifest[p.image]?.local,
    imageAlt: p.imageAlt,
    formats: p.formats,
    useCases: p.useCases,
    featuredIngredients: ingredients,
    libraryBase: p.libraryBase,
    naturallyDerived: p.naturallyDerived,
    freeFrom: p.freeFrom,
    featured: p.featured,
    featuredOrder: p.featuredOrder,
  });

  if (!data.image) throw new Error(`product ${p.slug}: image missing from manifest`);
  await fs.writeFile(path.join(productsDir, `${p.slug}.md`), fm(data));
}

// ------------------------------------------------------------- posts
const postsDir = path.join(ROOT, "src/content/learning-lab");

await fs.mkdir(postsDir, { recursive: true });
for (const p of posts) {
  const body = bodyToMdx(p);
  const data = clean({
    title: p.title,
    description: p.description,
    excerpt: p.excerpt || undefined,
    image: p.image ? manifest[p.image]?.local : undefined,
    imageAlt: p.imageAlt,
    publishedDate: p.publishedDate,
    modifiedDate: p.modifiedDate,
    author: await authorFor(p),
    tags: p.tagSlugs,
    featured: FEATURED_POSTS.includes(p.slug) || undefined,
  });

  await fs.writeFile(path.join(postsDir, `${p.slug}.mdx`), `${fm(data)}\n${body}`);
}

// ------------------------------------------------------------- data files
await fs.writeFile(
  path.join(ROOT, "src/data/productTaxonomy.json"),
  `${JSON.stringify({ formatGroups: taxonomy.formatGroups, useCases: taxonomy.useCases }, null, 2)}\n`
);
await fs.writeFile(
  path.join(ROOT, "src/data/learningLabTags.json"),
  `${JSON.stringify(
    Object.entries(taxonomy.tags).map(([slug, label]) => ({
      slug,
      label,
      icon: TAG_ICONS[slug] ? `/src/assets/images/hubfs/${TAG_ICONS[slug]}` : "",
    })),
    null,
    2
  )}\n`
);

await fs.writeFile(
  path.join(ROOT, "src/data/learningLabAuthors.json"),
  `${JSON.stringify(
    [...authors].sort().map(([slug, name]) => ({ slug, name })),
    null,
    2
  )}\n`
);

// Redirects for old URLs we know about (live site's own redirects + repaired ones).
for (const href of Object.keys(resolution)) {
  if (!href.startsWith("/")) continue;
  const d = decide(href);

  if (d.to && d.to !== href.replace(/\/$/, "")) redirects.set(href.replace(/\/$/, ""), d.to);
}
await fs.writeFile(
  path.join(CACHE, "parsed/redirects.json"),
  JSON.stringify(Object.fromEntries([...redirects].sort()), null, 2)
);
await fs.writeFile(
  path.join(CACHE, "parsed/link-report.json"),
  JSON.stringify(linkReport, null, 2)
);

console.log(`products written: ${products.length}, posts written: ${posts.length}`);
console.log(
  `links rewritten: ${Object.keys(linkReport.rewritten).length}, unlinked (dead): ${Object.keys(linkReport.unlinked).length}, unchanged: ${Object.keys(linkReport.unchanged).length}`
);
console.log(`redirects: ${redirects.size}`);
