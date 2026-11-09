// Usage: node scripts/migrate/compare-screenshots.mjs <live.png> <local.png> <out.jpg>
// Places two screenshots side by side (scaled to the same width) with labels, for visual comparison.
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../../package.json", import.meta.url))("sharp");
const [a, b, out] = process.argv.slice(2);
const W = 900;
const load = async (f) => {
  const img = sharp(f).resize({ width: W });
  const buf = await img.toBuffer();
  const m = await sharp(buf).metadata();

  return { buf, h: m.height };
};
const [la, lb] = await Promise.all([load(a), load(b)]);
const H = Math.max(la.h, lb.h) + 40;
const label = (t, x) => ({
  input: Buffer.from(
    `<svg width="${W}" height="40"><rect width="100%" height="100%" fill="#222"/><text x="12" y="27" font-family="Helvetica" font-size="22" fill="#fff">${t}</text></svg>`
  ),
  left: x,
  top: 0,
});

await sharp({ create: { width: W * 2 + 20, height: H, channels: 3, background: "#888" } })
  .composite([
    label("LIVE (twincraft.com)", 0),
    label("LOCAL (new build)", W + 20),
    { input: la.buf, left: 0, top: 40 },
    { input: lb.buf, left: W + 20, top: 40 },
  ])
  .jpeg({ quality: 70 })
  .toFile(out);
console.log(out);
