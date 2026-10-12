// Contact form rules: the names of the five form fields (name, email, message, consent, and cf-turnstile-response, which holds the Turnstile token), the length limits, and the validation of a submission. Validation first normalizes each value (the name and email address trimmed; the message with every CRLF and lone CR replaced by LF, then trimmed; the consent and token unchanged), then checks it: a name of 1 to 100 characters without control characters (U+0000 to U+001F and U+007F to U+009F); an email address of 1 to 254 characters that is a valid email address as HTML defines it; a message of 1 to 5000 characters with no control characters other than line feeds and tabs; a consent value of exactly yes; and a token of 1 to 2048 characters. It returns the normalized values, or, for each field that fails, the message that describes the first rule it fails. Lengths count UTF-16 code units, as the HTML maxlength attribute does.
export const fieldNames = [
	"name",
	"email",
	"message",
	"consent",
	"cf-turnstile-response",
] as const;

export type FieldName = (typeof fieldNames)[number];

export type ContactValues = Record<FieldName, string>;

export type ContactValidation =
	| { valid: true; values: ContactValues }
	| { valid: false; errors: Partial<Record<FieldName, string>> };

export const limits = {
	name: 100,
	email: 254,
	message: 5000,
	token: 2048,
};

const nameControlCharacters = /[\u0000-\u001f\u007f-\u009f]/;

const messageControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const emailAddress =
	/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Returns a field's value as normalized for validation.
function normalize(field: FieldName, value: string): string {
	switch (field) {
		case "name":
		case "email":
			return value.trim();
		case "message":
			return value.replace(/\r\n?/g, "\n").trim();
		case "consent":
		case "cf-turnstile-response":
			return value;
	}
}

// Returns the message for the first rule that a field's normalized value fails, or undefined if the value passes all of the field's rules.
function ruleMessage(field: FieldName, value: string): string | undefined {
	switch (field) {
		case "name":
			if (value.length === 0) {
				return "Enter your name.";
			}
			if (value.length > limits.name) {
				return `Name must be ${limits.name} characters or fewer.`;
			}
			if (nameControlCharacters.test(value)) {
				return "Name contains characters that are not allowed.";
			}
			return undefined;
		case "email":
			if (value.length === 0) {
				return "Enter your email address.";
			}
			if (value.length > limits.email) {
				return `Email address must be ${limits.email} characters or fewer.`;
			}
			if (!emailAddress.test(value)) {
				return "Enter an email address in the correct format, like name@example.com.";
			}
			return undefined;
		case "message":
			if (value.length === 0) {
				return "Enter your message.";
			}
			if (value.length > limits.message) {
				return `Message must be ${limits.message} characters or fewer.`;
			}
			if (messageControlCharacters.test(value)) {
				return "Message contains characters that are not allowed.";
			}
			return undefined;
		case "consent":
			if (value !== "yes") {
				return "Confirm that you agree to the processing of your information.";
			}
			return undefined;
		case "cf-turnstile-response":
			if (value.length === 0 || value.length > limits.token) {
				return "Complete the verification check.";
			}
			return undefined;
	}
}

// Normalizes and validates the five values of a submission, returning the normalized values if every value passes its rules, or otherwise the message for each field whose value fails.
export function validateContact(input: ContactValues): ContactValidation {
	const values = { ...input };
	const errors: Partial<Record<FieldName, string>> = {};
	for (const field of fieldNames) {
		values[field] = normalize(field, input[field]);
		const message = ruleMessage(field, values[field]);
		if (message !== undefined) {
			errors[field] = message;
		}
	}
	if (Object.keys(errors).length > 0) {
		return { valid: false, errors };
	}
	return { valid: true, values };
}
