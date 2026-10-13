// PM2 process definition for the Solvaxon server; PM2 recognizes this file as a configuration file because its name ends with .config.js. It defines one app, named solvaxon, which PM2 starts in this directory (the project root) from the standalone server that the build writes to dist/server/entry.mjs, an ES module that PM2 loads with import(). Node.js runs the app with --env-file=.env, which loads the variables from the .env file in this directory and stops Node.js with an error if that file is missing; a variable that is already set in the environment PM2 gives the app takes precedence over the file, and PM2 gives the app the environment of the shell that runs pm2 start, so that shell must not export Solvaxon's variables. The app runs in fork mode as one process, because the contact action keeps its limits, its duplicate check, and its shutdown state in the memory of one process; the mode is set explicitly because PM2 runs a Node.js app in cluster mode when its number of instances is set and its mode is not. To stop or restart the app, PM2 sends it SIGINT and, if it is still running after the kill timeout of 25000 ms, SIGKILL; the timeout covers one contact submission's requests to Turnstile and Mailgun (two Turnstile attempts of up to 4000 ms each, 1000 ms apart, and one Mailgun attempt of up to 10000 ms add up to 19000 ms) and the 5000 ms wait of the graceful shutdown, with 1000 ms to spare. PM2 prefixes each line of the app's output with the date and time. Every other setting keeps its PM2 default.
module.exports = {
	apps: [
		{
			name: "solvaxon",
			cwd: __dirname,
			script: "./dist/server/entry.mjs",
			node_args: "--env-file=.env",
			exec_mode: "fork",
			instances: 1,
			kill_timeout: 25000,
			time: true,
		},
	],
};
