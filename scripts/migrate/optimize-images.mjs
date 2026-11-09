// Shrinks oversized source images in src/assets/images. Astro already generates small, optimised
// versions at build time, so this only cuts repository size and build time:
//   - caps width at 2560px (larger than any size the site renders)
//   - recompresses JPEGs (mozjpeg, q82)
//   - converts large opaque PNG photos to JPEG, and rewrites every reference to them
//   - recompresses remaining PNGs losslessly
// A file is only replaced when the result is meaningfully smaller.
// Usage: node scripts/migrate/optimize-images.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { ROOT } from "./lib.mjs";

const write = process.argv.includes("--write");
const MAX_WIDTH = 2560;
const PNG_TO_JPEG_MIN_BYTES = 300 * 1024;
const MIN_SAVING = 0.1; // keep the original unless we save at least 10%

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const images = tracked.filter((f) => /^src\/assets\/images\/.*\.(png|jpe?g)$/i.test(f));
const textFiles = tracked.filter(
  (f) => /\.(md|mdx|json|ya?ml|astro|ts|js|mjs|css)$/.test(f) && !f.startsWith("scripts/migrate/")
);
const allPaths = new Set(tracked);

let before = 0;
let after = 0;
const renames = new Map(); // "/src/assets/..png" -> "/src/assets/..jpg"

for (const rel of images) {
  const abs = path.join(ROOT, rel);
  const input = fs.readFileSync(abs);
  const size = input.length;

  before += size;
  let meta;

  try {
    meta = await sharp(input).metadata();
  } catch {
    after += size;
    continue;
  }
  const isPng = meta.format === "png";
  const resize = meta.width > MAX_WIDTH ? { width: MAX_WIDTH } : null;
  let out = null;
  let outRel = rel;

  if (isPng) {
    const { isOpaque } = await sharp(input).stats();

    if (isOpaque && size >= PNG_TO_JPEG_MIN_BYTES && !meta.pages) {
      const jpg = await sharp(input)
        .resize(resize ?? {})
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      let candidate = rel.replace(/\.png$/i, ".jpg");

      for (let n = 2; allPaths.has(candidate); n++) candidate = rel.replace(/\.png$/i, `-${n}.jpg`);
      out = jpg;
      outRel = candidate;
    } else {
      out = await sharp(input)
        .resize(resize ?? {})
        .png({ compressionLevel: 9, effort: 10 })
        .toBuffer();
    }
  } else if (meta.format === "jpeg") {
    out = await sharp(input)
      .rotate()
      .resize(resize ?? {})
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  }

  if (!out || out.length > size * (1 - MIN_SAVING)) {
    after += size;
    continue;
  }
  after += out.length;
  if (outRel !== rel) {
    renames.set(`/${rel}`, `/${outRel}`);
    allPaths.add(outRel);
  }
  if (write) {
    fs.writeFileSync(path.join(ROOT, outRel), out);
    if (outRel !== rel) execFileSync("git", ["rm", "-q", "--cached", rel], { cwd: ROOT });
    if (outRel !== rel) fs.rmSync(abs);
  }
}

// Point references at the converted JPEGs.
let refs = 0;

for (const f of textFiles) {
  const abs = path.join(ROOT, f);
  let s = fs.readFileSync(abs, "utf8");
  const orig = s;

  for (const [from, to] of renames) {
    if (s.includes(from)) {
      refs += s.split(from).length - 1;
      s = s.split(from).join(to);
    }
  }
  if (write && s !== orig) fs.writeFileSync(abs, s);
}

// Keep the importer's manifest in step so re-running import.mjs uses the new names.
const manifestPath = path.join(ROOT, ".migration-cache/parsed/asset-manifest.json");

if (write && renames.size && fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  for (const m of Object.values(manifest))
    if (m.local && renames.has(m.local)) m.local = renames.get(m.local);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;

console.log(
  `${images.length} images: ${mb(before)} -> ${mb(after)}; ${renames.size} PNG photos -> JPEG (${refs} references)`
);
if (!write) console.log("dry run; pass --write to apply");
