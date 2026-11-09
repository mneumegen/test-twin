import { glob } from "astro/loaders";

/** Use the filename as the id unchanged, so live URLs with dots (e.g. "...-vs.-private-label") survive. */
const fileId = ({ entry }: { entry: string }) => entry.replace(/\.(md|mdx)$/, "");

import { defineCollection, z } from "astro:content";

const contentBlockSchema = z.object({ _component: z.string() }).passthrough();

const pageSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  image: z.string().optional(),
  canonical: z.string().optional(),
  pageSections: z.array(contentBlockSchema),
});

const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: pageSchema,
});

/** Product concepts from the Product Innovation Team. Data only: one shared template renders them. */
const productsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/products", generateId: fileId }),
  schema: z.object({
    title: z.string(),
    summary: z.string().default(""),
    image: z.string(),
    imageAlt: z.string().default(""),
    /** Values from src/data/productTaxonomy.json `formatGroups[].items[].value`. */
    formats: z.array(z.string()).default([]),
    /** Values from src/data/productTaxonomy.json `useCases[].value`. */
    useCases: z.array(z.string()).default([]),
    /** Markdown (inline) strings, e.g. "**Shea butter** moisturizes". */
    featuredIngredients: z.array(z.string()).default([]),
    libraryBase: z.string().default(""),
    naturallyDerived: z.string().default(""),
    freeFrom: z.array(z.string()).default([]),
    /** Shown in the "Current Innovation Collection" on /products. */
    featured: z.boolean().default(false),
    featuredOrder: z.number().optional(),
    description: z.string().optional(),
  }),
});

/** Learning Lab articles. */
const learningLabCollection = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/learning-lab",
    generateId: fileId,
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(""),
    /** Short teaser on article cards; falls back to the description. */
    excerpt: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().default(""),
    publishedDate: z.coerce.date(),
    modifiedDate: z.coerce.date().optional(),
    /** Author slug from src/data/learningLabAuthors.json. */
    author: z.string().default("twincraft"),
    /** Tag slugs from src/data/learningLabTags.json. */
    tags: z.array(z.string()).default([]),
    /** Shown under "Featured Articles" on /learning-lab. */
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  pages: pagesCollection,
  products: productsCollection,
  learningLab: learningLabCollection,
};
