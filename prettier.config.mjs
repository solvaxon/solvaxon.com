// Prettier settings: tabs for indentation, and the Astro plugin and parser for .astro files.
export default {
	useTabs: true,
	plugins: ["prettier-plugin-astro"],
	overrides: [
		{
			files: "*.astro",
			options: {
				parser: "astro",
			},
		},
	],
};
