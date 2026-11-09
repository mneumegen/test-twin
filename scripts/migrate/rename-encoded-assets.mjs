// Renames images whose paths contain URL-encoding or other unsafe characters (e.g. "Beach%20Bar.png",
// "TWC Horizontal_Blue 1.png") to plain, web-safe names ("Beach-Bar.png", "TWC-Horizontal_Blue-1.png")
// and rewrites every reference in the repo. CloudCannon's editor can't load files whose names contain
// "%", spaces or brackets, so they wouldn't preview in the Visual Editor.
// Usage: node scripts/migrate/rename-encoded-assets.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { ROOT } from "./lib.mjs";

const write = process.argv.includes("--write");
const ASSETS = path.join(ROOT, "src/assets/images");

const files = [];

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);

    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(ASSETS);

const unsafe = (s) => /[^A-Za-z0-9._/-]/.test(s);
const safe = (seg) => {
  let s = seg;

  try {
    s = decodeURIComponent(seg);
  } catch {
    /* keep as-is */
  }
  const ext = path.extname(s);
  const base = s.slice(0, s.length - ext.length);

  return (
    base
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") + ext.toLowerCase()
  );
};

// Map every file whose path has unsafe characters to a plain, web-safe path.
const sha = (f) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const relOf = (f) => `/${path.relative(ROOT, f).split(path.sep).join("/")}`;
const existing = new Map(files.map((f) => [relOf(f), f]));
const map = new Map(); // old rel -> new rel
const duplicates = []; // old rels whose bytes already exist at the target
let collisions = 0;

for (const f of files) {
  const rel = relOf(f);

  if (!unsafe(rel)) continue;
  const parts = rel.split("/");
  let next = parts.map((p, i) => (i < 4 || !unsafe(p) ? p : safe(p))).join("/");
  const taken = (candidate) =>
    [...map.values()].includes(candidate) ||
    (existing.has(candidate) && !unsafe(relOf(existing.get(candidate))));

  if (taken(next)) {
    const other = existing.get(next);

    if (other && sha(other) === sha(f)) {
      duplicates.push(rel);
      map.set(rel, next);
      continue;
    }
    const ext = path.extname(next);

    for (let n = 2; taken(next); n++)
      next = `${next.slice(0, next.length - ext.length).replace(/-\d+$/, "")}-${n}${ext}`;
    collisions++;
  }
  map.set(rel, next);
}
console.log(`identical duplicates: ${duplicates.length}, renamed with suffix: ${collisions}`);

// References: any tracked text file mentioning an old path.
const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(
    (f) => /\.(md|mdx|json|ya?ml|astro|ts|js|mjs|css)$/.test(f) && !f.startsWith("scripts/migrate/")
  );
let refCount = 0;
const changedFiles = [];
// Longest paths first so a directory rename can't clobber a longer match.
const pairs = [...map].sort((a, b) => b[0].length - a[0].length);

for (const f of tracked) {
  const abs = path.join(ROOT, f);
  let s = fs.readFileSync(abs, "utf8");
  const orig = s;

  for (const [from, to] of pairs) {
    if (s.includes(from)) {
      refCount += s.split(from).length - 1;
      s = s.split(from).join(to);
    }
  }
  if (s !== orig) {
    changedFiles.push(f);
    if (write) fs.writeFileSync(abs, s);
  }
}

console.log(
  `files with unsafe names: ${map.size}, references: ${refCount} in ${changedFiles.length} files`
);

if (write) {
  for (const [from, to] of map) {
    const a = path.join(ROOT, from);
    const b = path.join(ROOT, to);

    if (duplicates.includes(from)) {
      execFileSync("git", ["rm", "-q", "--cached", "--ignore-unmatch", a], { cwd: ROOT });
      fs.rmSync(a);
      continue;
    }
    fs.mkdirSync(path.dirname(b), { recursive: true });
    execFileSync("git", ["mv", "-k", a, b], { cwd: ROOT });
    if (fs.existsSync(a)) fs.renameSync(a, b); // untracked files
  }
  // Remove now-empty directories left behind by directory renames.
  (function prune(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory()) prune(path.join(dir, e.name));
    if (dir !== ASSETS && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  })(ASSETS);
  fs.writeFileSync(
    path.join(ROOT, ".migration-cache/asset-renames.json"),
    JSON.stringify(Object.fromEntries(map), null, 2)
  );
  // Keep the importer's manifest in step so re-running import.mjs uses the new names.
  const manifestPath = path.join(ROOT, ".migration-cache/parsed/asset-manifest.json");

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    for (const m of Object.values(manifest))
      if (m.local && map.has(m.local)) m.local = map.get(m.local);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  console.log("renamed; map saved to .migration-cache/asset-renames.json");
} else {
  console.log("dry run; sample:", [...map].slice(0, 5));
}
