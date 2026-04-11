import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckAlbumExists = vi.fn();
const mockCreateRekognitionCollection = vi.fn();
const mockCreateAlbumMetadata = vi.fn();
const mockCreateBucketAlbum = vi.fn();
const mockDeleteRekognitionCollection = vi.fn();
const mockDeleteBucketAlbumPlaceholder = vi.fn();
const mockDeleteBucketAlbum = vi.fn();
const mockDeleteAlbumMetadata = vi.fn();
const mockGetAlbumMetadata = vi.fn();
const mockListAlbumFaces = vi.fn();

vi.mock("./picture-album-management.service", () => ({
	PictureAlbumManagementService: vi.fn().mockImplementation(() => ({
		checkAlbumExists: mockCheckAlbumExists,
		createRekognitionCollection: mockCreateRekognitionCollection,
		createAlbumMetadata: mockCreateAlbumMetadata,
		createBucketAlbum: mockCreateBucketAlbum,
		deleteRekognitionCollection: mockDeleteRekognitionCollection,
		deleteBucketAlbumPlaceholder: mockDeleteBucketAlbumPlaceholder,
		deleteBucketAlbum: mockDeleteBucketAlbum,
		deleteAlbumMetadata: mockDeleteAlbumMetadata,
		getAlbumMetadata: mockGetAlbumMetadata,
		listAlbumFaces: mockListAlbumFaces,
	})),
}));

const mockGetSignedUrl = vi
	.fn()
	.mockResolvedValue("https://s3.example.com/presigned");

vi.mock("@aws-sdk/s3-request-presigner", () => ({
	getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

vi.mock("../../providers", () => ({
	S3Singleton: {
		getInstance: () => ({
			send: vi.fn(),
			bucketName: "test-bucket",
		}),
	},
	DynamoSingleton: {
		getInstance: () => ({
			send: vi.fn(),
			tableName: "test-table",
		}),
	},
}));

const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const { pictureAlbumManagementRoute } = await import(
	"./picture-album-manager.routes"
);

describe("POST /albums", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 201 when album is created successfully", async () => {
		mockCheckAlbumExists.mockResolvedValue(false);
		mockCreateRekognitionCollection.mockResolvedValue(undefined);
		mockCreateAlbumMetadata.mockResolvedValue(undefined);
		mockCreateBucketAlbum.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(201);
		const body = await res.json();

		expect(body.message).toContain("created");
	});

	it("returns 409 when album already exists", async () => {
		mockCheckAlbumExists.mockResolvedValue(true);

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(409);
	});

	it("returns 500 and performs rollback when creation fails", async () => {
		mockCheckAlbumExists.mockResolvedValue(false);
		mockCreateRekognitionCollection.mockResolvedValue(undefined);
		mockCreateAlbumMetadata.mockRejectedValue(new Error("DynamoDB error"));
		mockDeleteRekognitionCollection.mockResolvedValue(undefined);
		mockDeleteBucketAlbumPlaceholder.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(500);
		expect(mockDeleteRekognitionCollection).toHaveBeenCalledWith(VALID_UUID);
		expect(mockDeleteBucketAlbumPlaceholder).toHaveBeenCalledWith(VALID_UUID);
	});

	it("returns 400 when externalClientAlbumId is not a valid UUID", async () => {
		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ externalClientAlbumId: "not-a-uuid" }),
		});

		expect(res.status).toBe(400);
	});
});

describe("DELETE /albums/:externalClientAlbumId", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 200 when album is deleted", async () => {
		mockCheckAlbumExists.mockResolvedValue(true);
		mockDeleteRekognitionCollection.mockResolvedValue(undefined);
		mockDeleteBucketAlbum.mockResolvedValue(undefined);
		mockDeleteAlbumMetadata.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "DELETE" },
		);

		expect(res.status).toBe(200);
	});

	it("returns 404 when album does not exist", async () => {
		mockCheckAlbumExists.mockResolvedValue(false);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "DELETE" },
		);

		expect(res.status).toBe(404);
	});
});

describe("GET /albums/:externalClientAlbumId", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 200 with album metadata", async () => {
		mockGetAlbumMetadata.mockResolvedValue({
			externalClientAlbumId: VALID_UUID,
			photos: [],
			faces: [],
		});

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET" },
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.externalClientAlbumId).toBe(VALID_UUID);
	});

	it("returns 404 when album is not found", async () => {
		mockGetAlbumMetadata.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET" },
		);

		expect(res.status).toBe(404);
	});
});

describe("GET /albums/:externalClientAlbumId/faces", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 200 with faces list", async () => {
		mockCheckAlbumExists.mockResolvedValue(true);
		mockListAlbumFaces.mockResolvedValue([
			{
				FaceId: "face-1",
				CollectionId: VALID_UUID,
				CreatedAt: "2024-01-01T00:00:00.000Z",
			},
		]);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces`,
			{ method: "GET" },
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.faces).toHaveLength(1);
	});

	it("returns 404 when album does not exist", async () => {
		mockCheckAlbumExists.mockResolvedValue(false);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces`,
			{ method: "GET" },
		);

		expect(res.status).toBe(404);
	});
});

describe("POST /albums/:externalClientAlbumId/upload-url", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 200 with uploadUrl and key when album exists", async () => {
		mockCheckAlbumExists.mockResolvedValue(true);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/upload-url`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: "photo.jpg" }),
			},
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.uploadUrl).toBe("https://s3.example.com/presigned");
		expect(body.key).toMatch(
			new RegExp(`^uploads/incoming/${VALID_UUID}/[a-f0-9-]+\\.jpg$`),
		);
	});

	it("returns 404 when album does not exist", async () => {
		mockCheckAlbumExists.mockResolvedValue(false);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/upload-url`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: "photo.jpg" }),
			},
		);

		expect(res.status).toBe(404);
	});

	it("returns 400 when filename is missing", async () => {
		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/upload-url`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);

		expect(res.status).toBe(400);
	});
});
