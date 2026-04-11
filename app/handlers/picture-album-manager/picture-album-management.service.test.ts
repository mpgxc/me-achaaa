import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DynamoSingleton,
	RekognitionSingleton,
	S3Singleton,
} from "../../providers";
import { PictureAlbumManagementService } from "./picture-album-management.service";

// Mock AWS SDK clients
const mockDynamoSend = vi.fn();
const mockRekognitionSend = vi.fn();
const mockS3Send = vi.fn();

vi.mock("../../providers", () => ({
	DynamoSingleton: {
		getInstance: () => ({
			send: mockDynamoSend,
			tableName: "test-table",
		}),
	},
	RekognitionSingleton: {
		getInstance: () => ({
			send: mockRekognitionSend,
		}),
	},
	S3Singleton: {
		getInstance: () => ({
			send: mockS3Send,
			bucketName: "test-bucket",
		}),
	},
}));

describe("PictureAlbumManagementService", () => {
	let service: PictureAlbumManagementService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new PictureAlbumManagementService(
			{ send: mockS3Send, bucketName: "test-bucket" } as unknown as S3Singleton,
			{
				send: mockDynamoSend,
				tableName: "test-table",
			} as unknown as DynamoSingleton,
			{ send: mockRekognitionSend } as unknown as RekognitionSingleton,
		);
	});

	describe("checkAlbumExists", () => {
		it("returns true when item exists in DynamoDB", async () => {
			mockDynamoSend.mockResolvedValueOnce({
				Item: { PK: { S: "ALBUM#123" } },
			});

			const result = await service.checkAlbumExists("123");

			expect(result).toBe(true);
		});

		it("returns false when item does not exist in DynamoDB", async () => {
			mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

			const result = await service.checkAlbumExists("123");

			expect(result).toBe(false);
		});
	});

	describe("getAlbumMetadata", () => {
		it("returns album content when item exists", async () => {
			const mockContent = {
				externalClientAlbumId: "album-1",
				photos: [],
				faces: [],
			};
			// Return a marshalled DynamoDB item
			mockDynamoSend.mockResolvedValueOnce({
				Item: {
					PK: { S: "ALBUM#album-1" },
					SK: { S: "METADATA" },
					Content: {
						M: {
							externalClientAlbumId: { S: "album-1" },
							photos: { L: [] },
							faces: { L: [] },
						},
					},
					CreatedAt: { S: "2024-01-01T00:00:00.000Z" },
				},
			});

			const result = await service.getAlbumMetadata("album-1");

			expect(result).toEqual(mockContent);
		});

		it("returns null when album does not exist", async () => {
			mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

			const result = await service.getAlbumMetadata("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("createAlbumMetadata", () => {
		it("calls DynamoDB PutItem with correct PK and SK", async () => {
			mockDynamoSend.mockResolvedValueOnce({});

			await service.createAlbumMetadata("album-99");

			const call = mockDynamoSend.mock.calls[0][0];

			expect(call.input.Item.PK.S).toBe("ALBUM#album-99");
			expect(call.input.Item.SK.S).toBe("METADATA");
		});
	});

	describe("deleteAlbumMetadata", () => {
		it("calls DynamoDB DeleteItem with correct key", async () => {
			mockDynamoSend.mockResolvedValueOnce({});

			await service.deleteAlbumMetadata("album-99");

			const call = mockDynamoSend.mock.calls[0][0];

			expect(call.input.Key.PK.S).toBe("ALBUM#album-99");
			expect(call.input.Key.SK.S).toBe("METADATA");
		});
	});

	describe("createBucketAlbum", () => {
		it("calls S3 PutObject with the placeholder key", async () => {
			mockS3Send.mockResolvedValueOnce({});

			await service.createBucketAlbum("album-99");

			const call = mockS3Send.mock.calls[0][0];

			expect(call.input.Key).toBe("uploads/album-99/");
			expect(call.input.Bucket).toBe("test-bucket");
		});
	});

	describe("deleteBucketAlbumPlaceholder", () => {
		it("calls S3 DeleteObject with the placeholder key", async () => {
			mockS3Send.mockResolvedValueOnce({});

			await service.deleteBucketAlbumPlaceholder("album-99");

			const call = mockS3Send.mock.calls[0][0];

			expect(call.input.Key).toBe("uploads/album-99/");
			expect(call.input.Bucket).toBe("test-bucket");
		});
	});

	describe("createRekognitionCollection", () => {
		it("calls Rekognition CreateCollection with the album id", async () => {
			mockRekognitionSend.mockResolvedValueOnce({});

			await service.createRekognitionCollection("album-99");

			const call = mockRekognitionSend.mock.calls[0][0];

			expect(call.input.CollectionId).toBe("album-99");
		});
	});

	describe("deleteRekognitionCollection", () => {
		it("calls Rekognition DeleteCollection with the album id", async () => {
			mockRekognitionSend.mockResolvedValueOnce({});

			await service.deleteRekognitionCollection("album-99");

			const call = mockRekognitionSend.mock.calls[0][0];

			expect(call.input.CollectionId).toBe("album-99");
		});
	});
});
