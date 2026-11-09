// Step 3b: cap newly downloaded originals at 2560px wide (the largest width the site renders).
// Usage: node scripts/migrate/shrink.mjs
// Only touches files listed in the asset manifest; keeps format and filename.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { CACHE, ROOT } from "./lib.mjs";

const sharp = createRequire(path.join(ROOT, "package.json"))("sharp"); // reuse the site's sharp
const MAX = 2560;
const manifest = JSON.parse(
  await fs.readFile(path.join(CACHE, "parsed/asset-manifest.json"), "utf8")
);
let before = 0,
  after = 0,
  resized = 0;

for (const m of Object.values(manifest)) {
  if (!m.local) continue;
  const abs = path.join(ROOT, m.local);
  const buf = await fs.readFile(abs);

  before += buf.length;
  const meta = await sharp(buf).metadata();

  m.width = meta.width;
  m.height = meta.height;
  if (meta.width > MAX) {
    const img = sharp(buf).rotate().resize({ width: MAX });
    const ext = path.extname(abs).toLowerCase();
    const outBuf = await (
      ext === ".png"
        ? img.png({ compressionLevel: 9, palette: false })
        : img.jpeg({ quality: 85, mozjpeg: true })
    ).toBuffer();

    if (outBuf.length < buf.length) {
      await fs.writeFile(abs, outBuf);
      const nm = await sharp(outBuf).metadata();

      Object.assign(m, {
        originalWidth: meta.width,
        originalHeight: meta.height,
        width: nm.width,
        height: nm.height,
      });
      resized++;
      after += outBuf.length;
      continue;
    }
  }
  after += buf.length;
}
await fs.writeFile(
  path.join(CACHE, "parsed/asset-manifest.json"),
  JSON.stringify(manifest, null, 2)
);
console.log(
  `resized ${resized}; ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`
);
