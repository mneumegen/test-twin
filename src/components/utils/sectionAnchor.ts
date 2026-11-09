import { slugifyLabel } from "./slugify";

const usedIdsByRender = new WeakMap<object, Set<string>>();

export function reserveSectionId(renderKey: object, base: string): string {
  let used = usedIdsByRender.get(renderKey);

  if (!used) {
    used = new Set();
    usedIdsByRender.set(renderKey, used);
  }
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();

    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return NAMED_ENTITIES[lower] ?? match;
  });
}

export function firstHeadingSlug(html: string): string {
  const match = HEADING_RE.exec(html);

  if (!match) return "";
  const text = decodeEntities(match[1].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  return slugifyLabel(text);
}

function findHeadingText(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findHeadingText(item);

      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;

  if (
    typeof record._component === "string" &&
    /(^|\/)heading$/.test(record._component) &&
    typeof record.text === "string" &&
    record.text.trim().length > 0
  ) {
    return record.text;
  }
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === "object") {
      const found = findHeadingText(value);

      if (found) return found;
    }
  }
  return null;
}

export function firstHeadingSlugFromBlocks(blocks: unknown): string {
  const text = findHeadingText(blocks);

  if (!text) return "";
  return slugifyLabel(text.replace(/<[^>]*>/g, " "));
}
