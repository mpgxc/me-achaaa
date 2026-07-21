import type { SQSEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAlbum = vi.fn();

vi.mock("./picture-album-manager/picture-album-management.service", () => ({
	PictureAlbumManagementService: class {
		getAlbum = mockGetAlbum;
	},
}));

const mockGetTenant = vi.fn();

vi.mock("./picture-album-manager/auth/tenant.service", () => ({
	TenantService: class {
		getTenant = mockGetTenant;
	},
}));

const { deliverNotification, handler, resolveWebhookUrl } = await import(
	"./notification-dispatcher"
);

const EVENT = {
	type: "image.processed",
	collectionId: "col-1",
	imageId: "img-9",
	faceIds: ["f1"],
};

const makeEvent = (body: unknown): SQSEvent =>
	({
		Records: [{ body: JSON.stringify(body), messageId: "m1" }],
	}) as unknown as SQSEvent;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("resolveWebhookUrl", () => {
	it("returns the tenant webhook for the collection", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "t1", content: {} });
		mockGetTenant.mockResolvedValue({ webhookUrl: "https://hook.test" });

		expect(await resolveWebhookUrl("col-1")).toBe("https://hook.test");
	});

	it("returns null when the album has no owning tenant", async () => {
		mockGetAlbum.mockResolvedValue(null);

		expect(await resolveWebhookUrl("col-1")).toBeNull();
	});

	it("returns null when the tenant has no webhook", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "t1", content: {} });
		mockGetTenant.mockResolvedValue({ webhookUrl: undefined });

		expect(await resolveWebhookUrl("col-1")).toBeNull();
	});
});

describe("deliverNotification", () => {
	it("POSTs the event to the webhook", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);

		await deliverNotification("https://hook.test", EVENT);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://hook.test",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("throws when the webhook returns a non-ok status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);

		await expect(
			deliverNotification("https://hook.test", EVENT),
		).rejects.toThrow("HTTP 500");
	});
});

describe("handler", () => {
	it("delivers and reports no failures on success", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "t1", content: {} });
		mockGetTenant.mockResolvedValue({ webhookUrl: "https://hook.test" });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

		const res = await handler(makeEvent(EVENT));

		expect(res.batchItemFailures).toEqual([]);
	});

	it("skips without failure when no webhook is configured", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "t1", content: {} });
		mockGetTenant.mockResolvedValue({ webhookUrl: undefined });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const res = await handler(makeEvent(EVENT));

		expect(res.batchItemFailures).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reports the item as failed when delivery throws", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "t1", content: {} });
		mockGetTenant.mockResolvedValue({ webhookUrl: "https://hook.test" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 502 }),
		);

		const res = await handler(makeEvent(EVENT));

		expect(res.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
	});
});
