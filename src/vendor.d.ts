declare module "markdown-it" {
  interface Options {
    html?: boolean;
    xhtmlOut?: boolean;
    breaks?: boolean;
    langPrefix?: string;
    linkify?: boolean;
    typographer?: boolean;
  }

  interface MarkdownIt {
    render(src: string, env?: Record<string, unknown>): string;
    renderInline(src: string, env?: Record<string, unknown>): string;
  }

  export default function markdownit(options?: Options | string): MarkdownIt;
}
