import learningLabAuthors from "@data/learningLabAuthors.json";
import learningLabTags from "@data/learningLabTags.json";
import productTaxonomy from "@data/productTaxonomy.json";
import { getCollection, type CollectionEntry } from "astro:content";

export type Product = CollectionEntry<"products">;
export type Post = CollectionEntry<"learningLab">;

export const productUrl = (p: Product) => `/products/${p.id}`;
export const postUrl = (p: Post) => `/learning-lab/${p.id}`;
export const tagUrl = (slug: string) => `/learning-lab/tag/${slug}`;
export const authorUrl = (slug: string) => `/learning-lab/author/${slug}`;
export const allAuthors = learningLabAuthors;
/** Display name, e.g. "Anna Keller, Director of Trend & Marketing Strategy". */
export const authorName = (slug: string) =>
  learningLabAuthors.find((a) => a.slug === slug)?.name ?? slug;

/** Product library order: alphabetical by title. */
export async function getProducts(): Promise<Product[]> {
  const products = await getCollection("products");

  return products.sort((a, b) =>
    a.data.title.localeCompare(b.data.title, "en", { sensitivity: "base" })
  );
}

/** "Current Innovation Collection": featured products in their featured order. */
export async function getFeaturedProducts(): Promise<Product[]> {
  const products = await getCollection("products", (p) => p.data.featured);

  return products.sort((a, b) => (a.data.featuredOrder ?? 999) - (b.data.featuredOrder ?? 999));
}

/** Learning Lab order: newest first. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("learningLab");

  return posts.sort((a, b) => b.data.publishedDate.valueOf() - a.data.publishedDate.valueOf());
}

export function tagLabel(slug: string): string {
  return learningLabTags.find((t) => t.slug === slug)?.label ?? slug.replace(/-/g, " ");
}
export const allTags = learningLabTags;

const formatLabels = new Map(
  productTaxonomy.formatGroups.flatMap((g) => g.items.map((i) => [i.value, i.label] as const))
);
const useCaseLabels = new Map(productTaxonomy.useCases.map((u) => [u.value, u.label] as const));

export const formatLabel = (v: string) => formatLabels.get(v) ?? v;
export const useCaseLabel = (v: string) => useCaseLabels.get(v) ?? v;
export const formatGroups = productTaxonomy.formatGroups;
export const useCases = productTaxonomy.useCases;
