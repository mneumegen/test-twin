import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { authorName, getPosts, postUrl, tagLabel } from "@component-utils/collections";

export async function GET(context: APIContext) {
  const posts = await getPosts();

  return rss({
    title: "Learning Lab | Twincraft",
    description:
      "Articles and resources on manufacturing, product development and industry trends from Twincraft Skincare.",
    site: context.site ?? "https://www.twincraft.com",
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.publishedDate,
      link: postUrl(p),
      categories: p.data.tags.map(tagLabel),
      author: authorName(p.data.author).split(",")[0],
    })),
  });
}
