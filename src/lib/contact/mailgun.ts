// Mailgun delivery: sends an enquiry as a plain-text email to the private destination address with Mailgun's send API, at the API base URL of the sending domain's region, authenticated with HTTP Basic auth (user api, password the sending key). The email comes from the name Solvaxon website and the address contact-form at the sending domain; its subject is "Website enquiry from" followed by the visitor's name; its Reply-To is the visitor's email address; click and open tracking are off; and its text is three labelled lines (the visitor's name, email address, and consent time), a blank line, and the message. There is one attempt, with a 10000 ms timeout and no retry, because a send that timed out may still have been accepted. The result is sent (with Mailgun's message id), unavailable (HTTP 429 or 5xx, a timeout, or a network error), or rejected (any other HTTP status except 200); a 200 response whose body is not JSON or has no message id makes the send throw.
import { Buffer } from "node:buffer";
import {
	CONTACT_TO_ADDRESS,
	MAILGUN_DOMAIN,
	MAILGUN_REGION,
	MAILGUN_SENDING_KEY,
} from "astro:env/server";

export interface Enquiry {
	name: string;
	email: string;
	message: string;
	consentTime: string;
}

export type DeliveryResult =
	| { outcome: "sent"; id: string }
	| { outcome: "unavailable"; detail: string }
	| { outcome: "rejected"; status: number };

const apiBaseUrls = {
	us: "https://api.mailgun.net",
	eu: "https://api.eu.mailgun.net",
};

const sendTimeout = 10000;

// Returns the message id from Mailgun's parsed response to an accepted message, or throws if the response has none.
function messageId(result: unknown): string {
	if (
		typeof result === "object" &&
		result !== null &&
		"id" in result &&
		typeof result.id === "string"
	) {
		return result.id;
	}
	throw new Error("The Mailgun response has no message id.");
}

// Sends the enquiry email in one attempt, reading the whole response, and classifies the result.
export async function sendEnquiry(enquiry: Enquiry): Promise<DeliveryResult> {
	const form = new FormData();
	form.append("from", `Solvaxon website <contact-form@${MAILGUN_DOMAIN}>`);
	form.append("to", CONTACT_TO_ADDRESS);
	form.append("subject", `Website enquiry from ${enquiry.name}`);
	form.append(
		"text",
		`Name: ${enquiry.name}\nEmail: ${enquiry.email}\nConsent: given ${enquiry.consentTime}\n\n${enquiry.message}`,
	);
	form.append("h:Reply-To", enquiry.email);
	form.append("o:tracking-clicks", "no");
	form.append("o:tracking-opens", "no");
	let status: number;
	let body: string;
	try {
		const response = await fetch(
			`${apiBaseUrls[MAILGUN_REGION]}/v3/${MAILGUN_DOMAIN}/messages`,
			{
				method: "POST",
				headers: {
					Authorization: `Basic ${Buffer.from(`api:${MAILGUN_SENDING_KEY}`).toString("base64")}`,
				},
				body: form,
				signal: AbortSignal.timeout(sendTimeout),
			},
		);
		status = response.status;
		body = await response.text();
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			return { outcome: "unavailable", detail: "timeout" };
		}
		if (error instanceof TypeError) {
			return { outcome: "unavailable", detail: "network" };
		}
		throw error;
	}
	if (status === 429 || status >= 500) {
		return { outcome: "unavailable", detail: String(status) };
	}
	if (status !== 200) {
		return { outcome: "rejected", status };
	}
	return { outcome: "sent", id: messageId(JSON.parse(body)) };
}
