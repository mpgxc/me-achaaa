import { marshall } from "@aws-sdk/util-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamoSingleton } from "../../../providers";
import { SearchCacheService, hashImage } from "./search-cache.service";

const mockDynamoSend = vi.fn();

vi.mock("../../../providers", () => ({
	DynamoSingleton: {
		getInstance: () => ({ send: mockDynamoSend, tableName: "test-table" }),
	},
}));

describe("hashImage", () => {
	it("is deterministic for the same bytes", () => {
		expect(hashImage(Buffer.from("abc"))).toBe(hashImage(Buffer.from("abc")));
	});

	it("differs for different bytes", () => {
		expect(hashImage(Buffer.from("abc"))).not.toBe(
			hashImage(Buffer.from("abd")),
		);
	});
});

describe("SearchCacheService", () => {
	let cache: SearchCacheService;

	beforeEach(() => {
		vi.clearAllMocks();
		cache = new SearchCacheService({
			send: mockDynamoSend,
			tableName: "test-table",
		} as unknown as DynamoSingleton);
	});

	describe("get", () => {
		it("returns the cached images on a hit", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "SEARCHCACHE#col",
					SK: "HASH#h",
					images: ["img-1", "img-2"],
					ExpiresAt: Math.floor(Date.now() / 1000) + 3600,
				}),
			});

			expect(await cache.get("col", "h")).toEqual(["img-1", "img-2"]);
		});

		it("returns an empty array (still a hit) for a cached no-match", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({ PK: "SEARCHCACHE#col", SK: "HASH#h", images: [] }),
			});

			expect(await cache.get("col", "h")).toEqual([]);
		});

		it("returns null on a miss", async () => {
			mockDynamoSend.mockResolvedValue({ Item: undefined });

			expect(await cache.get("col", "h")).toBeNull();
		});

		it("returns null when the record is already expired", async () => {
			mockDynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "SEARCHCACHE#col",
					SK: "HASH#h",
					images: ["img-1"],
					ExpiresAt: Math.floor(Date.now() / 1000) - 10,
				}),
			});

			expect(await cache.get("col", "h")).toBeNull();
		});
	});

	describe("put", () => {
		it("stores the images with an ExpiresAt in the future", async () => {
			mockDynamoSend.mockResolvedValue({});

			await cache.put("col", "h", ["img-1"]);

			const call = mockDynamoSend.mock.calls[0][0];
			expect(call.input.Item.PK.S).toBe("SEARCHCACHE#col");
			expect(call.input.Item.SK.S).toBe("HASH#h");
			expect(Number(call.input.Item.ExpiresAt.N)).toBeGreaterThan(
				Math.floor(Date.now() / 1000),
			);
		});
	});
});
