// Astro configuration: the production site URL; page URLs that end with a slash (each page built as an index.html file in its own directory, except the 404 page, which is built as 404.html); lossless HTML whitespace removal; the Content Security Policy that Astro adds to every page in a meta element (resources, the base URL, and form submission targets all limited to the site's own origin, no object or embed content, and hashes of Astro's built-in scripts and of the scripts and styles that Astro processes); no Markdown syntax highlighting, because Astro's default highlighter, Shiki, uses inline styles that the policy blocks; the Node.js adapter in standalone mode, which builds a server that serves the built files and renders the routes that are not prerendered; no sessions, so the adapter sets up no session storage, and the session runtime stays out of the server bundle; and the sitemap integration, which writes a sitemap index and a sitemap of the site's pages (every page except the 404 page) when the site is built, and whose namespaces option excludes the unused news, xhtml, image, and video XML namespaces from the sitemap.
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
	site: "https://solvaxon.com",
	trailingSlash: "always",
	build: {
		format: "directory",
	},
	compressHTML: true,
	security: {
		csp: {
			directives: [
				"default-src 'self'",
				"base-uri 'self'",
				"form-action 'self'",
				"object-src 'none'",
			],
		},
	},
	markdown: {
		syntaxHighlight: false,
	},
	adapter: node({
		mode: "standalone",
	}),
	session: false,
	integrations: [
		sitemap({
			namespaces: {
				news: false,
				xhtml: false,
				image: false,
				video: false,
			},
		}),
	],
});
