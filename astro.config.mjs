// Astro configuration: the production site URL, page URLs that end with a slash (each page built as an index.html file in its own directory), lossless HTML whitespace removal, the Content Security Policy that Astro adds to every page in a meta element (resources, the base URL, and form submission targets limited to the site's own origin, no object or embed content, and hashes of the scripts and styles Astro emits), and no Markdown syntax highlighting, because Astro's default highlighter, Shiki, uses inline styles that the policy blocks.
import { defineConfig } from "astro/config";

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
});
