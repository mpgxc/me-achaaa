import type { SQSEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handler } = await import("./failure-notification");

const makeSQSEvent = (bodies: string[]): SQSEvent => ({
	Records: bodies.map((body, i) => ({
		messageId: `msg-${i}`,
		body,
		receiptHandle: "",
		attributes: {} as never,
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "",
		awsRegion: "us-east-1",
	})),
});

describe("FailureNotification handler", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.example.com/webhook");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		globalThis.fetch = originalFetch;
	});

	it("does nothing when DISCORD_WEBHOOK_URL is not set", async () => {
		vi.stubEnv("DISCORD_WEBHOOK_URL", "");
		const mockFetch = vi.fn();
		globalThis.fetch = mockFetch;

		const event = makeSQSEvent(['{"error": "test"}']);

		await handler(event);

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("calls the Discord webhook with the message body", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
		globalThis.fetch = mockFetch;

		const event = makeSQSEvent(['{"error": "something failed"}']);

		await handler(event);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];

		expect(url).toBe("https://discord.example.com/webhook");
		expect(options.method).toBe("POST");

		const body = JSON.parse(options.body as string);

		expect(body.embeds[0].fields[0].value).toContain("something failed");
	});

	it("calls the webhook once per SQS record", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
		globalThis.fetch = mockFetch;

		const event = makeSQSEvent(["msg-1", "msg-2", "msg-3"]);

		await handler(event);

		expect(mockFetch).toHaveBeenCalledTimes(3);
	});

	it("throws when the Discord webhook returns a non-ok response", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
		globalThis.fetch = mockFetch;

		const event = makeSQSEvent(["error-body"]);

		await expect(handler(event)).rejects.toThrow("HTTP 500");
	});
});
