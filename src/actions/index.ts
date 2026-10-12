// Astro actions: the contact action, which Astro serves at /_actions/contact/ and which accepts form data. For each submission it receives, the handler records the time of receipt as the consent time, reads exactly the five contact fields (each sent once, as text), validates their values with the contact form rules, verifies the Turnstile token for the hostname of the configured site URL, and sends the enquiry through Mailgun; when Mailgun accepts the email, the handler returns nothing, which Astro answers with status 204. The handler logs how each submission ends as one line that starts with "contact" and contains no personal data, and it reports every failure as an ActionError with a fixed message: BAD_REQUEST for invalid input, FORBIDDEN when the token fails verification, SERVICE_UNAVAILABLE when Turnstile or Mailgun is unavailable, and INTERNAL_SERVER_ERROR for a Turnstile configuration error, a send that Mailgun rejects, or any unexpected error.
import {
	ActionError,
	defineAction,
	type ActionAPIContext,
} from "astro:actions";
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

// Runs the steps for one submission (reading the fields, validating the values, verifying the Turnstile token, and sending the email) and logs the successful send or each failure that a step reports, throwing the matching ActionError for that failure; any other error reaches the caller unchanged.
async function processSubmission(
	formData: FormData,
	context: ActionAPIContext,
): Promise<void> {
	const consentTime = new Date().toISOString();
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
	const { values } = validation;
	if (context.site === undefined) {
		throw new Error("The site URL is not configured.");
	}
	const verification = await verifyToken(
		values["cf-turnstile-response"],
		context.site.hostname,
	);
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
			break;
	}
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
			context.logger.info(`contact sent ${JSON.stringify(delivery.id)}`);
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
