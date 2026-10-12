// Contact abuse controls, which keep their state only in this process's memory, so a restart clears it: the attempt limit for each client address, the send capacity, and the duplicate check. Every submission that reaches the action while the process is not shutting down counts as an attempt for its client address, a rejected one included, and an attempt is rejected when at least 5 earlier attempts of its address from the past 60 minutes are kept; at most 10000 addresses are kept, so when that many are kept, a new address replaces the one whose latest attempt is the oldest, and the replaced address's attempts are forgotten. At most 20 sends to Mailgun are attempted in any 60 minutes: a submission reserves a send before its Turnstile check, so that submissions that wait for Turnstile at the same time cannot exceed the limit, and the reservation becomes a send attempt when Mailgun is contacted, or is released if the submission ends before that. Each enquiry that Mailgun accepts is remembered for 60 minutes as the SHA-256 hash of its email address and message, joined by a line feed, so that an enquiry with the same email address and message is not sent again in that time. Each limit reports its first rejection apart from later ones, so that the action logs only the first: the attempt limit, the first rejection of an address since its last allowed attempt; the send capacity, the first rejection since the last reservation. Times come from performance.now(), a monotonic clock that is not affected by changes to the system clock. Timers remove the attempt times and send times as they become 60 minutes old, and an address with its last attempt time; each hash is removed by its own timer 60 minutes after the latest delivery of its enquiry.
import { hash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";

export type AttemptResult = "allowed" | "limited" | "still_limited";

export type ReservationResult = "reserved" | "full" | "still_full";

interface Client {
	times: number[];
	expiry: NodeJS.Timeout;
	rejectionReported: boolean;
}

const windowLength = 60 * 60 * 1000;

const attemptLimit = 5;

const clientLimit = 10000;

const sendLimit = 20;

const clients = new Map<string, Client>();

const sendTimes: number[] = [];

let sendExpiryPending = false;

let reservedSends = 0;

let capacityRejectionReported = false;

const deliveredEnquiries = new Map<string, NodeJS.Timeout>();

// Removes the times that are at least 60 minutes old from the start of an ascending list of times.
function removeExpiredTimes(times: number[], now: number): void {
	let expired = 0;
	for (const time of times) {
		if (time > now - windowLength) {
			break;
		}
		expired += 1;
	}
	times.splice(0, expired);
}

// Runs from an address's timer: removes the address's expired attempt times, and then removes the address if it has no time left, or otherwise sets its timer again for when its oldest remaining time expires.
function expireClient(address: string): void {
	const client = clients.get(address);
	if (client === undefined) {
		return;
	}
	const now = performance.now();
	removeExpiredTimes(client.times, now);
	const oldest = client.times[0];
	if (oldest === undefined) {
		clients.delete(address);
		return;
	}
	client.expiry = setTimeout(
		expireClient,
		oldest + windowLength - now,
		address,
	);
}

// Removes the first address in the map and stops its timer; the first address is the one whose latest attempt is the oldest, because each attempt moves its address to the end of the map.
function evictOldestClient(): void {
	for (const [address, client] of clients) {
		clearTimeout(client.expiry);
		clients.delete(address);
		break;
	}
}

// Counts an attempt for a client address: makes room if 10000 addresses are kept and the address is new, moves the address to the end of the map, and keeps at most its 5 latest attempt times of the past 60 minutes. Reports whether the attempt is allowed (fewer than 5 earlier attempt times of the address from the past 60 minutes were kept), or is the first or a later rejection since the address's last allowed attempt.
export function countAttempt(address: string): AttemptResult {
	const now = performance.now();
	let client = clients.get(address);
	if (client === undefined) {
		if (clients.size >= clientLimit) {
			evictOldestClient();
		}
		client = {
			times: [],
			expiry: setTimeout(expireClient, windowLength, address),
			rejectionReported: false,
		};
	} else {
		clients.delete(address);
		removeExpiredTimes(client.times, now);
	}
	clients.set(address, client);
	const allowed = client.times.length < attemptLimit;
	client.times.push(now);
	if (client.times.length > attemptLimit) {
		client.times.shift();
	}
	if (allowed) {
		client.rejectionReported = false;
		return "allowed";
	}
	if (client.rejectionReported) {
		return "still_limited";
	}
	client.rejectionReported = true;
	return "limited";
}

// Runs from the send capacity's timer: removes the expired send times, and sets the timer again for when the oldest remaining time expires, if one is left.
function expireSendTimes(): void {
	const now = performance.now();
	removeExpiredTimes(sendTimes, now);
	const oldest = sendTimes[0];
	if (oldest === undefined) {
		sendExpiryPending = false;
		return;
	}
	setTimeout(expireSendTimes, oldest + windowLength - now);
}

// Reserves a send if the sends attempted in the past 60 minutes and the sends reserved now number fewer than 20, and otherwise reports whether this is the first or a later rejection since the last reservation.
export function reserveSend(): ReservationResult {
	removeExpiredTimes(sendTimes, performance.now());
	if (sendTimes.length + reservedSends < sendLimit) {
		reservedSends += 1;
		capacityRejectionReported = false;
		return "reserved";
	}
	if (capacityRejectionReported) {
		return "still_full";
	}
	capacityRejectionReported = true;
	return "full";
}

// Releases a reserved send that was not attempted.
export function releaseSend(): void {
	reservedSends -= 1;
}

// Turns a reserved send into a send attempt at the current time, which counts against the send capacity until it is 60 minutes old.
export function recordSendAttempt(): void {
	reservedSends -= 1;
	sendTimes.push(performance.now());
	if (!sendExpiryPending) {
		sendExpiryPending = true;
		setTimeout(expireSendTimes, windowLength);
	}
}

// Returns the SHA-256 hash, in hexadecimal, of an enquiry's email address and message joined by a line feed, encoded as UTF-8.
function enquiryHash(email: string, message: string): string {
	return hash("sha256", `${email}\n${message}`);
}

// Runs from a hash's timer: forgets the hash of a delivered enquiry.
function forgetEnquiry(digest: string): void {
	deliveredEnquiries.delete(digest);
}

// Returns true if an enquiry with the same email address and message was delivered in the past 60 minutes.
export function isDuplicate(email: string, message: string): boolean {
	return deliveredEnquiries.has(enquiryHash(email, message));
}

// Remembers a delivered enquiry for 60 minutes from now; if it is already remembered, its 60 minutes start again.
export function recordDelivery(email: string, message: string): void {
	const digest = enquiryHash(email, message);
	const expiry = deliveredEnquiries.get(digest);
	if (expiry === undefined) {
		deliveredEnquiries.set(
			digest,
			setTimeout(forgetEnquiry, windowLength, digest),
		);
	} else {
		expiry.refresh();
	}
}
