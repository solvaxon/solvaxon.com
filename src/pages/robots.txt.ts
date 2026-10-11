// robots.txt, built as a static file at /robots.txt: first a user-agent * group that allows crawling of the whole site, then a Sitemap line with the full URL of the sitemap index.
import type { APIRoute } from "astro";

// Returns the robots.txt text for the given sitemap index URL.
const getRobotsTxt = (sitemapURL: URL) => `\
User-agent: *
Allow: /

Sitemap: ${sitemapURL.href}
`;

// Resolves sitemap-index.xml against the configured site URL, then returns a response whose body Astro writes to robots.txt when the site is built.
export const GET: APIRoute = ({ site }) => {
	const sitemapURL = new URL("sitemap-index.xml", site);
	return new Response(getRobotsTxt(sitemapURL));
};
