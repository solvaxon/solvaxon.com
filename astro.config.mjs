// Astro configuration: the production site URL, page URLs that end with a slash (each page built as an index.html file in its own directory), and lossless HTML whitespace removal.
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://solvaxon.com",
	trailingSlash: "always",
	build: {
		format: "directory",
	},
	compressHTML: true,
});
