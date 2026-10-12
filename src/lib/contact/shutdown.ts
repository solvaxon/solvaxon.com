// Graceful shutdown for the contact action. When PM2 stops or restarts the server, it sends SIGINT, and then SIGKILL if the server has not exited within the kill timeout set in ecosystem.config.js. The action's handler passes its request's logger to watchShutdown each time it runs: the first call keeps that logger and adds a SIGINT listener, which removes Node.js's default exit on SIGINT; no submission can be in flight before that first call. The handler's shutdown check is beginSubmission: while the process is shutting down, beginSubmission returns false, and the handler rejects the submission; otherwise beginSubmission counts the submission as in flight until endSubmission, which the handler calls as its last step. On the first SIGINT, the process starts shutting down: one line, "contact shutdown_started" followed by the number of submissions in flight, is logged with the kept logger, and the process exits with code 0, 5000 ms after the last submission in flight has ended, or 5000 ms after the signal if none is in flight. The wait gives the server time to finish writing the last response, which Astro starts to write as soon as the handler returns, and the last log lines: no stable API available to the application reports when they have been written, and output to a pipe, which is how PM2 receives the server's output, is written asynchronously on Linux, so an exit can drop it. Later SIGINT signals change nothing.
import process from "node:process";
import { setTimeout } from "node:timers";
import type { AstroRuntimeLogger } from "astro";

const exitDelay = 5000;

let logger: AstroRuntimeLogger | undefined;

let inFlight = 0;

let shuttingDown = false;

// Runs when the 5000 ms wait ends: exits the process with code 0.
function exitProcess(): void {
	process.exit(0);
}

// Starts the 5000 ms wait, after which the process exits.
function startExitWait(): void {
	setTimeout(exitProcess, exitDelay);
}

// Runs on SIGINT: on the first signal, marks the process as shutting down, logs the number of submissions in flight with the kept logger, and starts the wait before the exit if no submission is in flight; later signals change nothing.
function handleSigint(): void {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	logger?.info(`contact shutdown_started ${inFlight}`);
	if (inFlight === 0) {
		startExitWait();
	}
}

// The first time it is called, keeps the request's logger for the shutdown's log line and adds the SIGINT listener; later calls change nothing.
export function watchShutdown(requestLogger: AstroRuntimeLogger): void {
	if (logger !== undefined) {
		return;
	}
	logger = requestLogger;
	process.on("SIGINT", handleSigint);
}

// The shutdown check: returns false while the process is shutting down, and otherwise counts the submission as in flight and returns true.
export function beginSubmission(): boolean {
	if (shuttingDown) {
		return false;
	}
	inFlight += 1;
	return true;
}

// Ends a submission's time in flight; if the process is shutting down and no submission is left in flight, starts the wait before the exit.
export function endSubmission(): void {
	inFlight -= 1;
	if (shuttingDown && inFlight === 0) {
		startExitWait();
	}
}
