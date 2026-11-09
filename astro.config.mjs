import sitemap from "@astrojs/sitemap";
import editableRegions from "@cloudcannon/editable-regions/astro-integration";
import icon from "astro-icon";
import { defineConfig } from "astro/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mdx from "@astrojs/mdx";
// Required by @cloudcannon/editable-regions' React renderer (live-editing.js), not used for site components.
import react from "@astrojs/react";

import { siteFonts } from "./site-fonts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: "https://www.twincraft.com",
  fonts: siteFonts,
  // Match the live site's URLs: /about-us, not /about-us/ (keeps existing links and rankings).
  trailingSlash: "never",
  build: {
    format: "file",
    inlineStylesheets: "always",
  },
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4321,
  },
  image: {
    domains: [],
  },
  integrations: [
    editableRegions(),
    icon({
      iconDir: path.resolve(__dirname, "src/icons"),
      svgoOptions: {
        plugins: [
          {
            name: "preset-default",
            params: {
              overrides: {
                cleanupIds: false,
                // INVARIANT: extracted source icons keep their <defs> and <style> verbatim.
                // inlineStyles rewrites every rule into a style attribute and deletes the
                // <style> element (so a rule that only applies in a state — :hover, a media
                // query, a class toggled at runtime — is lost); minifyStyles deletes rules it
                // judges unused, which is every rule whose class is applied by the consumer
                // rather than by the icon markup; mergeStyles collapses separate <style>
                // elements into one. All three are silent: the glyph still renders, just
                // without the behaviour the source authored.
                inlineStyles: false,
                minifyStyles: false,
                mergeStyles: false,
              },
            },
          },
        ],
      },
    }),
    sitemap({
      filter: (page) => {
        if (page.endsWith("/404") || page.endsWith("/404.html")) {
          return false;
        }
        return true;
      },
    }),
    mdx(),
    react(),
  ],
  vite: {
    build: {
      minify: "esbuild",
    },
    plugins: [
      {
        name: "suppress-node-externalized-warning",
        config() {
          return {
            build: {
              rollupOptions: {
                onwarn(warning, defaultHandler) {
                  if (
                    warning.message?.includes("externalized for browser compatibility") &&
                    warning.message?.includes("discoverVideoSources")
                  )
                    return;
                  defaultHandler(warning);
                },
              },
            },
          };
        },
        configResolved(config) {
          const originalWarn = config.logger.warn;

          config.logger.warn = (msg, options) => {
            if (
              typeof msg === "string" &&
              msg.includes("externalized for browser compatibility") &&
              msg.includes("discoverVideoSources")
            )
              return;
            originalWarn(msg, options);
          };
        },
      },
    ],
    build: {
      chunkSizeWarningLimit: 1024,
    },
    css: {
      devSourcemap: true,
    },
    resolve: {
      alias: {
        "@components": path.resolve(__dirname, "src/components"),
        "@building-blocks": path.resolve(__dirname, "src/components/building-blocks"),
        "@core-elements": path.resolve(__dirname, "src/components/building-blocks/core-elements"),
        "@forms": path.resolve(__dirname, "src/components/building-blocks/forms"),
        "@wrappers": path.resolve(__dirname, "src/components/building-blocks/wrappers"),
        "@navigation": path.resolve(__dirname, "src/components/navigation"),
        "@page-sections": path.resolve(__dirname, "src/components/page-sections"),
        "@features": path.resolve(__dirname, "src/components/page-sections/features"),
        "@builders": path.resolve(__dirname, "src/components/page-sections/builders"),
        "@data": path.resolve(__dirname, "src/data"),
        "@content": path.resolve(__dirname, "src/content"),
        "@assets": path.resolve(__dirname, "src/assets"),
        "@layouts": path.resolve(__dirname, "src/layouts"),
        "@component-utils": path.resolve(__dirname, "src/components/utils"),
        "@styles": path.resolve(__dirname, "src/styles"),
      },
    },
  },
});
