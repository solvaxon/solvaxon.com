// Site-wide constants: the site name; the name and URL path of the Services and About pages (each page's name is the text of the header navigation link to it and the first word of its title and main heading, and its path is that link's target; the About page's link to the Services page also takes its target from the Services page's path and the start of its text from the Services page's name); and the Open Graph sharing image (URL path, MIME type, width and height in pixels, and alt text).
export const siteName = "Solvaxon";

export const servicesPage = {
	name: "Services",
	path: "/services/",
};

export const aboutPage = {
	name: "About",
	path: "/about/",
};

export const sharingImage = {
	path: "/solvaxon-og.png",
	type: "image/png",
	width: 1200,
	height: 630,
	alt: "Solvaxon. Web development. Built to solve. Websites and web applications, with the lime Solvaxon X on a deep-green background.",
};
