// Cloudflare Turnstile token verification on the server: sends the token to the Siteverify API as JSON with the Turnstile secret key and an idempotency key (a random UUID), without the visitor's IP address. Each attempt times out after 4000 ms; a network error, a timeout, an HTTP 5xx status, or the internal-error code is retried once, after 1000 ms, with the same idempotency key. The result is passed (success for the expected hostname), rejected (success without the expected hostname, reported as hostname_mismatch, or any other failure, reported as the list of its error codes), misconfigured (the missing-input-secret, invalid-input-secret, or bad-request code), or unavailable (the retry also ended in a network error, a timeout, an HTTP 5xx status, or the internal-error code). A response below HTTP 500 whose body is not JSON makes the verification throw.
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { TURNSTILE_SECRET_KEY } from "astro:env/server";

export type VerificationResult =
	| { outcome: "passed" }
	| { outcome: "rejected"; detail: string }
	| { outcome: "misconfigured"; code: string }
	| { outcome: "unavailable" };

const siteverifyUrl =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

const attemptTimeout = 4000;

const retryDelay = 1000;

const configurationErrorCodes = [
	"missing-input-secret",
	"invalid-input-secret",
	"bad-request",
];

// Returns the error codes that are strings in a parsed Siteverify result.
function errorCodes(result: object): string[] {
	const codes: string[] = [];
	if ("error-codes" in result && Array.isArray(result["error-codes"])) {
		for (const code of result["error-codes"]) {
			if (typeof code === "string") {
				codes.push(code);
			}
		}
	}
	return codes;
}

// Sends one Siteverify request, reading the whole response, and classifies the result, or returns undefined if the attempt may be retried.
async function attempt(
	token: string,
	idempotencyKey: string,
	hostname: string,
): Promise<VerificationResult | undefined> {
	let status: number;
	let body: string;
	try {
		const response = await fetch(siteverifyUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				secret: TURNSTILE_SECRET_KEY,
				response: token,
				idempotency_key: idempotencyKey,
			}),
			signal: AbortSignal.timeout(attemptTimeout),
		});
		status = response.status;
		body = await response.text();
	} catch (error) {
		if (
			error instanceof TypeError ||
			(error instanceof DOMException && error.name === "TimeoutError")
		) {
			return undefined;
		}
		throw error;
	}
	if (status >= 500) {
		return undefined;
	}
	const parsed: unknown = JSON.parse(body);
	const result = typeof parsed === "object" && parsed !== null ? parsed : {};
	if ("success" in result && result.success === true) {
		if ("hostname" in result && result.hostname === hostname) {
			return { outcome: "passed" };
		}
		return { outcome: "rejected", detail: "hostname_mismatch" };
	}
	const codes = errorCodes(result);
	if (codes.includes("internal-error")) {
		return undefined;
	}
	for (const code of codes) {
		if (configurationErrorCodes.includes(code)) {
			return { outcome: "misconfigured", code };
		}
	}
	return { outcome: "rejected", detail: JSON.stringify(codes) };
}

// Verifies a Turnstile token for the expected hostname, with a second attempt after 1000 ms if the first one may be retried.
export async function verifyToken(
	token: string,
	hostname: string,
): Promise<VerificationResult> {
	const idempotencyKey = randomUUID();
	const first = await attempt(token, idempotencyKey, hostname);
	if (first !== undefined) {
		return first;
	}
	await setTimeout(retryDelay);
	const second = await attempt(token, idempotencyKey, hostname);
	return second ?? { outcome: "unavailable" };
}
