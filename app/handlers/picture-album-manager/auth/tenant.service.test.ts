import { marshall } from "@aws-sdk/util-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamoSingleton } from "../../../providers";
import { TenantService } from "./tenant.service";

const mockDynamoSend = vi.fn();

vi.mock("../../../providers", () => ({
	DynamoSingleton: {
		getInstance: () => ({ send: mockDynamoSend, tableName: "test-table" }),
	},
}));

describe("TenantService", () => {
	let service: TenantService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new TenantService({
			send: mockDynamoSend,
			tableName: "test-table",
		} as unknown as DynamoSingleton);
	});

	describe("createTenant", () => {
		it("persists the tenant then issues an api key linked to it", async () => {
			mockDynamoSend.mockResolvedValue({});

			const { tenantId, apiKey } = await service.createTenant({ name: "Acme" });

			expect(tenantId).toMatch(/^[0-9a-f-]{36}$/i);
			expect(apiKey.startsWith("sls_")).toBe(true);

			const tenantPut = mockDynamoSend.mock.calls[0][0];
			expect(tenantPut.input.Item.PK.S).toBe(`TENANT#${tenantId}`);
			expect(tenantPut.input.Item.SK.S).toBe("METADATA");

			const apiKeyPut = mockDynamoSend.mock.calls[1][0];
			expect(apiKeyPut.input.Item.PK.S.startsWith("APIKEY#")).toBe(true);
			expect(apiKeyPut.input.Item.TenantId.S).toBe(tenantId);
		});

		it("stores the webhookUrl when provided", async () => {
			mockDynamoSend.mockResolvedValue({});

			await service.createTenant({
				name: "Acme",
				webhookUrl: "https://hook.test",
			});

			const tenantPut = mockDynamoSend.mock.calls[0][0];
			expect(tenantPut.input.Item.WebhookUrl.S).toBe("https://hook.test");
		});
	});

	describe("getTenant", () => {
		it("returns the tenant with its webhookUrl", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "TENANT#t1",
					SK: "METADATA",
					Name: "Acme",
					WebhookUrl: "https://hook.test",
				}),
			});

			expect(await service.getTenant("t1")).toEqual({
				webhookUrl: "https://hook.test",
			});
		});

		it("returns null when the tenant does not exist", async () => {
			mockDynamoSend.mockResolvedValue({ Item: undefined });

			expect(await service.getTenant("missing")).toBeNull();
		});
	});

	describe("resolveTenant", () => {
		it("returns the tenant for a known api key", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "APIKEY#hash",
					SK: "METADATA",
					TenantId: "tenant-9",
				}),
			});

			const tenant = await service.resolveTenant("sls_whatever");

			expect(tenant).toEqual({ id: "tenant-9" });
		});

		it("returns null when the api key is unknown", async () => {
			mockDynamoSend.mockResolvedValue({ Item: undefined });

			expect(await service.resolveTenant("sls_unknown")).toBeNull();
		});

		it("returns null when the api key is revoked", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({ TenantId: "tenant-9", Revoked: true }),
			});

			expect(await service.resolveTenant("sls_revoked")).toBeNull();
		});
	});
});
