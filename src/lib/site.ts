// Site-wide constants: the site name; the name and URL path of the Services and About pages (each page's name is the text of the header navigation link to it and the first word of its title and main heading, and its path is that link's target; the About page's link to the Services page also takes its target from the Services page's path and the start of its text from the Services page's name); the name and anchor of each of the four services (each name is the heading of the service's section on the Services page and the text of the home page's link to that section; each anchor is that section's id and the fragment of the link's target, which starts with the Services page's path); and the Open Graph sharing image (URL path, MIME type, width and height in pixels, and alt text).
export const siteName = "Solvaxon";

export const servicesPage = {
	name: "Services",
	path: "/services/",
};

export const aboutPage = {
	name: "About",
	path: "/about/",
};

export const services = {
	websites: {
		name: "Websites",
		anchor: "websites",
	},
	webApplications: {
		name: "Web applications",
		anchor: "web-applications",
	},
	customOnlineTools: {
		name: "Custom online tools",
		anchor: "custom-online-tools",
	},
	otherWebProjects: {
		name: "Other web projects",
		anchor: "other-web-projects",
	},
};

export const sharingImage = {
	path: "/solvaxon-og.png",
	type: "image/png",
	width: 1200,
	height: 630,
	alt: "Solvaxon. Web development. Built to solve. Websites and web applications, with the lime Solvaxon X on a deep-green background.",
};
