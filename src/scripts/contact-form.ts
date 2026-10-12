// Contact form behaviour: the script enables the send button when it starts, and when the page is shown (unless it came back from the back/forward cache), it unticks the consent box if the browser restored it ticked, so that Turnstile loads only after a tick on the page. The first time the consent box is ticked, it shows the verification part, whose space for the widget holds a loading note, and loads Cloudflare Turnstile's api.js from the exact URL Cloudflare gives, with explicit rendering; once api.js has loaded, it renders the compact widget, in English, into that space, with the site key from the space's data attribute. If Turnstile reports an error, or api.js cannot load (then the space is hidden), a message below the space offers the public email address; the message is cleared when the check passes. On submit, the browser's own submission is stopped, and a submission is ignored while a send is in progress; otherwise the five values are checked with the contact form rules, each error message is shown below its field (below the widget for the verification token), red borders mark an invalid name, email address, or message, and the focus moves to the first invalid field other than the verification token, which has no field that can take the focus. If every value is valid, the form data is sent to the contact action while the button reads "Sending...", and the message for the result is shown beside the button, in red unless the message was sent; after a successful send the form is reset, and after every send the widget is reset, because each token can be used only once. Messages are written as text, never as HTML, and the public email address comes from site.ts.
import { actions, type ActionErrorCode } from "astro:actions";
import {
	fieldNames,
	validateContact,
	type ContactValues,
	type FieldName,
} from "../lib/contact/rules";
import { publicEmail } from "../lib/site";

interface TurnstileOptions {
	sitekey: string;
	size: "normal" | "flexible" | "compact";
	language: string;
	callback: (token: string) => void;
	"error-callback": (errorCode: string) => boolean;
}

interface Turnstile {
	render: (
		container: string | HTMLElement,
		options: TurnstileOptions,
	) => string;
	reset: (widgetId: string) => void;
}

declare global {
	interface Window {
		turnstile?: Turnstile;
	}
}

const turnstileScriptUrl =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const sentMessage = "Thank you. Your message has been sent.";

const networkMessage =
	"Your message may not have been sent. Check your connection and try again.";

const verificationErrorMessage = `The verification check could not be completed. Reload the page, or email ${publicEmail}.`;

const sendingLabel = "Sending...";

const form = requireElement("contact-form", HTMLFormElement);

const nameField = requireElement("contact-name", HTMLInputElement);

const emailField = requireElement("contact-email", HTMLInputElement);

const messageField = requireElement("contact-message", HTMLTextAreaElement);

const consentBox = requireElement("contact-consent", HTMLInputElement);

const verification = requireElement("contact-verification", HTMLElement);

const widget = requireElement("contact-widget", HTMLElement);

const sendButton = requireElement("contact-send", HTMLButtonElement);

const result = requireElement("contact-result", HTMLElement);

const errorAreas: Record<FieldName, HTMLElement> = {
	name: requireElement("contact-name-error", HTMLElement),
	email: requireElement("contact-email-error", HTMLElement),
	message: requireElement("contact-message-error", HTMLElement),
	consent: requireElement("contact-consent-error", HTMLElement),
	"cf-turnstile-response": requireElement(
		"contact-verification-error",
		HTMLElement,
	),
};

const focusOrder: [FieldName, HTMLElement][] = [
	["name", nameField],
	["email", emailField],
	["message", messageField],
	["consent", consentBox],
];

const siteKey = requireData(widget, "sitekey");

const sendLabel = sendButton.textContent;

let widgetId: string | undefined;

let sending = false;

// Returns the element with the given id, or throws if the page has no element of the given type with that id.
function requireElement<T extends HTMLElement>(
	id: string,
	type: new () => T,
): T {
	const element = document.getElementById(id);
	if (!(element instanceof type)) {
		throw new Error(`The page has no contact form element with the id ${id}.`);
	}
	return element;
}

// Returns the value of an element's data attribute, or throws if the element has no such attribute.
function requireData(element: HTMLElement, name: string): string {
	const value = element.dataset[name];
	if (value === undefined) {
		throw new Error(
			`The element with the id ${element.id} has no data-${name} attribute.`,
		);
	}
	return value;
}

// Runs when the page is shown: unless the page came back from the browser's back/forward cache, which keeps the page and this script's state together, unticks the consent box if it is ticked although it was not ticked on the page, because browsers restore form state, without a change event, when they load a page again, and Chrome does so after the load event, so after this script has started.
function handlePageShow(event: PageTransitionEvent): void {
	if (!event.persisted && verification.hidden) {
		consentBox.checked = false;
	}
}

// Runs when the consent box changes; the first time it is ticked, stops listening for changes, shows the verification part with the loading note in the space for the widget, and loads Turnstile's api.js.
function handleConsentChange(): void {
	if (!consentBox.checked) {
		return;
	}
	consentBox.removeEventListener("change", handleConsentChange);
	verification.hidden = false;
	const script = document.createElement("script");
	script.src = turnstileScriptUrl;
	script.addEventListener("load", renderWidget);
	script.addEventListener("error", showLoadFailure);
	document.head.append(script);
}

// Runs when api.js has loaded: replaces the loading note with the compact Turnstile widget, in English; if api.js did not define Turnstile, handles this as a failure to load.
function renderWidget(): void {
	const turnstile = window.turnstile;
	if (turnstile === undefined) {
		showLoadFailure();
		return;
	}
	widget.replaceChildren();
	widgetId = turnstile.render(widget, {
		sitekey: siteKey,
		size: "compact",
		language: "en",
		callback: clearVerificationError,
		"error-callback": showVerificationError,
	});
}

// Runs when api.js cannot be loaded: hides the space for the widget and shows the verification error message instead.
function showLoadFailure(): void {
	widget.hidden = true;
	errorAreas["cf-turnstile-response"].textContent = verificationErrorMessage;
}

// Turnstile's error callback: shows the verification error message below the widget and returns true, so that Turnstile treats the error as handled.
function showVerificationError(): boolean {
	errorAreas["cf-turnstile-response"].textContent = verificationErrorMessage;
	return true;
}

// Turnstile's success callback: clears the message below the widget.
function clearVerificationError(): void {
	errorAreas["cf-turnstile-response"].textContent = "";
}

// Returns the five contact values from the form data, with an empty string for a field that the form data does not contain: an unticked consent box, or a verification token that Turnstile has not provided.
function readValues(formData: FormData): ContactValues {
	const values: ContactValues = {
		name: "",
		email: "",
		message: "",
		consent: "",
		"cf-turnstile-response": "",
	};
	for (const field of fieldNames) {
		const value = formData.get(field);
		if (typeof value === "string") {
			values[field] = value;
		}
	}
	return values;
}

// Checks the five values of the form data with the contact form rules and shows the outcome: each error message below its field (below the widget for the verification token; an empty message hides the area), a red border on an invalid name, email address, or message field, and the focus on the first invalid field among the name, email address, message, and consent box (the verification token has no field that can take the focus). Returns true if every value is valid.
function checkValues(formData: FormData): boolean {
	const validation = validateContact(readValues(formData));
	const errors: Partial<Record<FieldName, string>> = validation.valid
		? {}
		: validation.errors;
	for (const field of fieldNames) {
		errorAreas[field].textContent = errors[field] ?? "";
	}
	nameField.classList.toggle("invalid", errors.name !== undefined);
	emailField.classList.toggle("invalid", errors.email !== undefined);
	messageField.classList.toggle("invalid", errors.message !== undefined);
	for (const [field, element] of focusOrder) {
		if (errors[field] !== undefined) {
			element.focus();
			break;
		}
	}
	return validation.valid;
}

// Returns the message for the error code in the contact action's result.
function failureMessage(code: ActionErrorCode): string {
	switch (code) {
		case "BAD_REQUEST":
			return "Some information is missing or invalid. Check the form and try again.";
		case "FORBIDDEN":
			return "The verification check failed. Complete it again, then send your message.";
		case "TOO_MANY_REQUESTS":
			return `Too many attempts from your connection. Try again later, or email ${publicEmail}.`;
		case "SERVICE_UNAVAILABLE":
			return `Your message may not have been sent. Try again later, or email ${publicEmail}.`;
		default:
			return `Your message could not be sent. Email ${publicEmail} instead.`;
	}
}

// Shows a message beside the send button, in red if it reports a failure; an empty message hides the area.
function showResult(message: string, failure: boolean): void {
	result.textContent = message;
	result.classList.toggle("failure", failure);
}

// Resets the Turnstile widget, so that it obtains a new token.
function resetWidget(): void {
	if (widgetId !== undefined) {
		window.turnstile?.reset(widgetId);
	}
}

// Sends the form data to the contact action while the button reads "Sending...", and shows the message for the result beside the button: the sent message, the message for the action's error code, or, if the request itself fails (for example because the connection is lost), the network message. After a successful send it resets the form, and after every send it resets the widget, because the send may have used the token, which can be used only once.
async function send(formData: FormData): Promise<void> {
	sending = true;
	sendButton.textContent = sendingLabel;
	showResult("", false);
	try {
		const { error } = await actions.contact(formData);
		if (error === undefined) {
			form.reset();
			showResult(sentMessage, false);
		} else {
			showResult(failureMessage(error.code), true);
		}
	} catch {
		showResult(networkMessage, true);
	} finally {
		resetWidget();
		sendButton.textContent = sendLabel;
		sending = false;
	}
}

// Runs when the form is submitted: stops the browser's own submission, ignores the submission while a send is in progress, and otherwise sends the form data if every value is valid.
async function handleSubmit(event: SubmitEvent): Promise<void> {
	event.preventDefault();
	if (sending) {
		return;
	}
	const formData = new FormData(form);
	if (checkValues(formData)) {
		await send(formData);
	}
}

window.addEventListener("pageshow", handlePageShow);
consentBox.addEventListener("change", handleConsentChange);
form.addEventListener("submit", handleSubmit);
sendButton.disabled = false;
