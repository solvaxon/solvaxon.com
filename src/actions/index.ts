// Astro actions: the contact action, which Astro serves at /_actions/contact/ and which accepts form data. For each submission it receives, the handler records the time of receipt as the consent time and then takes these steps in order, each of which can end the submission: it counts the submission as an attempt for the client address and applies the attempt limit; reads exactly the five contact fields (each sent once, as text) and validates their values with the contact form rules; reserves a send within the send capacity; verifies the Turnstile token for the hostname of the configured site URL; ends the submission without a send if an enquiry with the same email address and message was delivered in the past 60 minutes; and sends the enquiry through Mailgun. A reserved send that is not attempted is released. When Mailgun accepts the email, or the enquiry is a duplicate, the handler returns nothing, which Astro answers with status 204. The handler logs how each submission ends as one line that starts with "contact" and contains no personal data; a rejection by the attempt limit or the send capacity is logged only when the limit reports it as its first. The handler reports every failure as an ActionError with a fixed message: TOO_MANY_REQUESTS when the client address has made too many attempts, BAD_REQUEST for invalid input, FORBIDDEN when the token fails verification, SERVICE_UNAVAILABLE when the send capacity is reached or Turnstile or Mailgun is unavailable, and INTERNAL_SERVER_ERROR for a Turnstile configuration error, a send that Mailgun rejects, or any unexpected error.
import {
	ActionError,
	defineAction,
	type ActionAPIContext,
} from "astro:actions";
import {
	countAttempt,
	isDuplicate,
	recordDelivery,
	recordSendAttempt,
	releaseSend,
	reserveSend,
} from "../lib/contact/limits";
import { sendEnquiry } from "../lib/contact/mailgun";
import {
	fieldNames,
	validateContact,
	type ContactValues,
	type FieldName,
} from "../lib/contact/rules";
import { verifyToken } from "../lib/contact/turnstile";

type InvalidInput =
	"unexpected_field" | "repeated_field" | "non_text_value" | "missing_field";

const failureMessages = {
	BAD_REQUEST: "Some information is missing or invalid.",
	FORBIDDEN: "The verification check failed.",
	TOO_MANY_REQUESTS: "Too many attempts from your connection.",
	SERVICE_UNAVAILABLE: "Your message may not have been sent.",
	INTERNAL_SERVER_ERROR: "Your message could not be sent.",
};

// Returns the ActionError for a failure code, with that code's fixed message.
function failure(code: keyof typeof failureMessages): ActionError {
	return new ActionError({ code, message: failureMessages[code] });
}

// Returns true if a form data key is one of the five contact field names.
function isFieldName(key: string): key is FieldName {
	return (fieldNames as readonly string[]).includes(key);
}

// Reads the five contact fields from the form data, or returns the first deviation found: a key that is not a contact field name, a field sent more than once, a value that is a file instead of text, or a missing field.
function readFields(formData: FormData): ContactValues | InvalidInput {
	const fields: Partial<ContactValues> = {};
	for (const [key, value] of formData) {
		if (!isFieldName(key)) {
			return "unexpected_field";
		}
		if (fields[key] !== undefined) {
			return "repeated_field";
		}
		if (typeof value !== "string") {
			return "non_text_value";
		}
		fields[key] = value;
	}
	const { name, email, message, consent } = fields;
	const token = fields["cf-turnstile-response"];
	if (
		name === undefined ||
		email === undefined ||
		message === undefined ||
		consent === undefined ||
		token === undefined
	) {
		return "missing_field";
	}
	return { name, email, message, consent, "cf-turnstile-response": token };
}

// Counts the submission as an attempt for the client address, and throws TOO_MANY_REQUESTS if the attempt limit rejects it, logging the rejection if the limit reports it as its first for the address.
function enforceAttemptLimit(context: ActionAPIContext): void {
	switch (countAttempt(context.clientAddress)) {
		case "limited":
			context.logger.warn("contact rate_limited");
			throw failure("TOO_MANY_REQUESTS");
		case "still_limited":
			throw failure("TOO_MANY_REQUESTS");
		case "allowed":
			return;
	}
}

// Reads the five contact fields and validates their values, returning the normalized values, or logs the kind of invalid input and throws BAD_REQUEST.
function readValues(
	formData: FormData,
	context: ActionAPIContext,
): ContactValues {
	const fields = readFields(formData);
	if (typeof fields === "string") {
		context.logger.warn(`contact invalid_input ${fields}`);
		throw failure("BAD_REQUEST");
	}
	const validation = validateContact(fields);
	if (!validation.valid) {
		context.logger.warn("contact invalid_input rule_failed");
		throw failure("BAD_REQUEST");
	}
	return validation.values;
}

// Reserves a send within the send capacity, or throws SERVICE_UNAVAILABLE if the capacity is reached, logging the rejection if the capacity reports it as its first.
function reserveCapacity(context: ActionAPIContext): void {
	switch (reserveSend()) {
		case "full":
			context.logger.warn("contact capacity_reached");
			throw failure("SERVICE_UNAVAILABLE");
		case "still_full":
			throw failure("SERVICE_UNAVAILABLE");
		case "reserved":
			return;
	}
}

// Verifies the Turnstile token for the hostname of the configured site URL, and logs the failure and throws the matching ActionError if the verification does not pass; throws an Error if no site URL is configured.
async function verifySubmission(
	token: string,
	context: ActionAPIContext,
): Promise<void> {
	if (context.site === undefined) {
		throw new Error("The site URL is not configured.");
	}
	const verification = await verifyToken(token, context.site.hostname);
	switch (verification.outcome) {
		case "rejected":
			context.logger.warn(`contact verification_failed ${verification.detail}`);
			throw failure("FORBIDDEN");
		case "misconfigured":
			context.logger.error(`contact configuration_error ${verification.code}`);
			throw failure("INTERNAL_SERVER_ERROR");
		case "unavailable":
			context.logger.error("contact verification_unavailable");
			throw failure("SERVICE_UNAVAILABLE");
		case "passed":
			return;
	}
}

// Sends the enquiry through Mailgun; when Mailgun accepts it, remembers the enquiry for the duplicate check and logs Mailgun's message id, and otherwise logs the failure and throws the matching ActionError.
async function deliver(
	values: ContactValues,
	consentTime: string,
	context: ActionAPIContext,
): Promise<void> {
	const delivery = await sendEnquiry({
		name: values.name,
		email: values.email,
		message: values.message,
		consentTime,
	});
	switch (delivery.outcome) {
		case "unavailable":
			context.logger.error(`contact delivery_unavailable ${delivery.detail}`);
			throw failure("SERVICE_UNAVAILABLE");
		case "rejected":
			context.logger.error(`contact delivery_rejected ${delivery.status}`);
			throw failure("INTERNAL_SERVER_ERROR");
		case "sent":
			recordDelivery(values.email, values.message);
			context.logger.info(`contact sent ${JSON.stringify(delivery.id)}`);
	}
}

// Records the time of receipt as the consent time, then runs the steps for one submission in order: the attempt limit, reading and validating the fields, the send reservation, the Turnstile verification, the duplicate check (an enquiry with the same email address and message as one delivered in the past 60 minutes ends the submission without a send, logged as a duplicate), and the delivery. A reserved send that is not attempted is released. The ActionErrors that the steps throw, and any other error, reach the caller unchanged.
async function processSubmission(
	formData: FormData,
	context: ActionAPIContext,
): Promise<void> {
	const consentTime = new Date().toISOString();
	enforceAttemptLimit(context);
	const values = readValues(formData, context);
	reserveCapacity(context);
	let sendAttempted = false;
	try {
		await verifySubmission(values["cf-turnstile-response"], context);
		if (isDuplicate(values.email, values.message)) {
			context.logger.info("contact duplicate");
			return;
		}
		recordSendAttempt();
		sendAttempted = true;
		await deliver(values, consentTime, context);
	} finally {
		if (!sendAttempted) {
			releaseSend();
		}
	}
}

// Handles a contact action request: runs the submission, passes its ActionErrors on, and turns any other error into INTERNAL_SERVER_ERROR after logging the error's name, or the type of a thrown value that is not an Error.
async function handleContact(
	formData: FormData,
	context: ActionAPIContext,
): Promise<void> {
	try {
		await processSubmission(formData, context);
	} catch (error) {
		if (error instanceof ActionError) {
			throw error;
		}
		context.logger.error(
			`contact unexpected_error ${error instanceof Error ? error.name : typeof error}`,
		);
		throw failure("INTERNAL_SERVER_ERROR");
	}
}

export const server = {
	contact: defineAction({
		accept: "form",
		handler: handleContact,
	}),
};
