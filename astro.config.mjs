// Astro configuration: the production site URL; page URLs that end with a slash (each page built as an index.html file in its own directory, except the 404 page, which is built as 404.html); lossless HTML whitespace removal; the Content Security Policy that Astro adds to every page in a meta element (resources, the base URL, and form submission targets all limited to the site's own origin, no object or embed content, and hashes of Astro's built-in scripts and of the scripts and styles that Astro processes); a limit of 65536 bytes on the body of each action request; https://solvaxon.com as the only allowed domain, so that the server uses a request's Host, X-Forwarded-Host, and X-Forwarded-Proto headers only when they match it (the server receives plain HTTP, so the Host header matches only with X-Forwarded-Proto https), never uses an X-Forwarded-Port header (the domain names no port), and takes the client address from the first X-Forwarded-For value when the request's host matches the domain and that header is present, and from the connection otherwise; no Markdown syntax highlighting, because Astro's default highlighter, Shiki, uses inline styles that the policy blocks; the Node.js adapter in standalone mode, which builds a server that serves the built files and renders the routes that are not prerendered; no sessions, so the adapter sets up no session storage, and the session runtime stays out of the server bundle; the sitemap integration, which writes a sitemap index and a sitemap of the site's pages (every page except the 404 page) when the site is built, and whose namespaces option excludes the unused news, xhtml, image, and video XML namespaces from the sitemap; Astro's no-op image service, so the image endpoint that Astro adds to the server returns the built site's files unchanged and never resizes or converts an image; and the environment variables for the contact form, all required: three public values, which Astro writes into the build output where they are used (the Turnstile site key, the Mailgun sending domain, and the Mailgun region, us or eu), and three secrets, which the server reads at runtime (the Turnstile secret key, the Mailgun sending key, and the private address that receives contact form submissions); Astro checks all six when the site is built.
import { defineConfig, envField, passthroughImageService } from "astro/config";
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
		actionBodySizeLimit: 65536,
		allowedDomains: [
			{
				protocol: "https",
				hostname: "solvaxon.com",
			},
		],
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
	image: {
		service: passthroughImageService(),
	},
	env: {
		schema: {
			TURNSTILE_SITE_KEY: envField.string({
				context: "server",
				access: "public",
				min: 1,
			}),
			TURNSTILE_SECRET_KEY: envField.string({
				context: "server",
				access: "secret",
				min: 1,
			}),
			MAILGUN_SENDING_KEY: envField.string({
				context: "server",
				access: "secret",
				min: 1,
			}),
			MAILGUN_DOMAIN: envField.string({
				context: "server",
				access: "public",
				min: 1,
			}),
			MAILGUN_REGION: envField.enum({
				context: "server",
				access: "public",
				values: ["us", "eu"],
			}),
			CONTACT_TO_ADDRESS: envField.string({
				context: "server",
				access: "secret",
				min: 1,
			}),
		},
		validateSecrets: true,
	},
});
