import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAlbum = vi.fn();
const mockCreateRekognitionCollection = vi.fn();
const mockCreateAlbumMetadata = vi.fn();
const mockCreateBucketAlbum = vi.fn();
const mockDeleteRekognitionCollection = vi.fn();
const mockDeleteBucketAlbumPlaceholder = vi.fn();
const mockDeleteBucketAlbum = vi.fn();
const mockDeleteAlbumMetadata = vi.fn();
const mockListAlbumFaces = vi.fn();
const mockDeleteFace = vi.fn();

vi.mock("./picture-album-management.service", () => ({
	PictureAlbumManagementService: class {
		getAlbum = mockGetAlbum;
		createRekognitionCollection = mockCreateRekognitionCollection;
		createAlbumMetadata = mockCreateAlbumMetadata;
		createBucketAlbum = mockCreateBucketAlbum;
		deleteRekognitionCollection = mockDeleteRekognitionCollection;
		deleteBucketAlbumPlaceholder = mockDeleteBucketAlbumPlaceholder;
		deleteBucketAlbum = mockDeleteBucketAlbum;
		deleteAlbumMetadata = mockDeleteAlbumMetadata;
		listAlbumFaces = mockListAlbumFaces;
		deleteFace = mockDeleteFace;
	},
}));

const mockResolveTenant = vi.fn();

vi.mock("./auth/tenant.service", () => ({
	TenantService: class {
		resolveTenant = mockResolveTenant;
	},
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
const TENANT_ID = "tenant-1";
const authHeaders = {
	"Content-Type": "application/json",
	Authorization: "Bearer test-key",
};

const { pictureAlbumManagementRoute } = await import(
	"./picture-album-manager.routes"
);

// Por padrão, a API key é válida e resolve para TENANT_ID.
beforeEach(() => {
	vi.clearAllMocks();
	mockGetSignedUrl.mockResolvedValue("https://s3.example.com/presigned");
	mockResolveTenant.mockResolvedValue({ id: TENANT_ID });
});

describe("authentication", () => {
	it("returns 401 when the API key is missing", async () => {
		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET" },
		);

		expect(res.status).toBe(401);
		expect(mockResolveTenant).not.toHaveBeenCalled();
	});

	it("returns 401 when the API key is invalid", async () => {
		mockResolveTenant.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(401);
	});
});

describe("POST /albums", () => {
	it("returns 201 when album is created successfully", async () => {
		mockGetAlbum.mockResolvedValue(null);
		mockCreateRekognitionCollection.mockResolvedValue(undefined);
		mockCreateAlbumMetadata.mockResolvedValue(undefined);
		mockCreateBucketAlbum.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(201);
		const body = await res.json();

		expect(body.message).toContain("created");
		// O álbum é criado já vinculado ao tenant autenticado.
		expect(mockCreateAlbumMetadata).toHaveBeenCalledWith(VALID_UUID, TENANT_ID);
	});

	it("returns 409 when album already exists", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(409);
	});

	it("returns 500 and performs rollback when creation fails", async () => {
		mockGetAlbum.mockResolvedValue(null);
		mockCreateRekognitionCollection.mockResolvedValue(undefined);
		mockCreateAlbumMetadata.mockRejectedValue(new Error("DynamoDB error"));
		mockDeleteRekognitionCollection.mockResolvedValue(undefined);
		mockDeleteBucketAlbumPlaceholder.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ externalClientAlbumId: VALID_UUID }),
		});

		expect(res.status).toBe(500);
		expect(mockDeleteRekognitionCollection).toHaveBeenCalledWith(VALID_UUID);
		expect(mockDeleteBucketAlbumPlaceholder).toHaveBeenCalledWith(VALID_UUID);
	});

	it("returns 400 when externalClientAlbumId is not a valid UUID", async () => {
		const res = await pictureAlbumManagementRoute.request("/albums", {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({ externalClientAlbumId: "not-a-uuid" }),
		});

		expect(res.status).toBe(400);
	});
});

describe("DELETE /albums/:externalClientAlbumId", () => {
	it("returns 200 when album is deleted", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
		mockDeleteRekognitionCollection.mockResolvedValue(undefined);
		mockDeleteBucketAlbum.mockResolvedValue(undefined);
		mockDeleteAlbumMetadata.mockResolvedValue(undefined);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(200);
	});

	it("returns 404 when album does not exist", async () => {
		mockGetAlbum.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(404);
	});

	it("returns 404 when the album belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other-tenant", content: {} });

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(404);
		// Não deve tentar deletar recursos de outro tenant.
		expect(mockDeleteRekognitionCollection).not.toHaveBeenCalled();
	});
});

describe("GET /albums/:externalClientAlbumId", () => {
	it("returns 200 with album metadata", async () => {
		mockGetAlbum.mockResolvedValue({
			tenantId: TENANT_ID,
			content: {
				externalClientAlbumId: VALID_UUID,
				photos: [],
				faces: [],
			},
		});

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.externalClientAlbumId).toBe(VALID_UUID);
	});

	it("returns 404 when album is not found", async () => {
		mockGetAlbum.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(404);
	});

	it("returns 404 when the album belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({
			tenantId: "other-tenant",
			content: { externalClientAlbumId: VALID_UUID, photos: [], faces: [] },
		});

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(404);
	});
});

describe("GET /albums/:externalClientAlbumId/faces", () => {
	it("returns 200 with faces list", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
		mockListAlbumFaces.mockResolvedValue([
			{
				FaceId: "face-1",
				CollectionId: VALID_UUID,
				CreatedAt: "2024-01-01T00:00:00.000Z",
			},
		]);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.faces).toHaveLength(1);
	});

	it("returns 404 when album does not exist", async () => {
		mockGetAlbum.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces`,
			{ method: "GET", headers: authHeaders },
		);

		expect(res.status).toBe(404);
	});
});

describe("DELETE /albums/:externalClientAlbumId/faces/:faceId", () => {
	const FACE_ID = "11111111-2222-3333-4444-555555555555";

	it("returns 200 when the face is deleted", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
		mockDeleteFace.mockResolvedValue(true);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces/${FACE_ID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(200);
		expect(mockDeleteFace).toHaveBeenCalledWith(VALID_UUID, FACE_ID);
	});

	it("returns 404 when the face does not exist", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
		mockDeleteFace.mockResolvedValue(false);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces/${FACE_ID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(404);
	});

	it("returns 404 when the album belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other-tenant", content: {} });

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces/${FACE_ID}`,
			{ method: "DELETE", headers: authHeaders },
		);

		expect(res.status).toBe(404);
		expect(mockDeleteFace).not.toHaveBeenCalled();
	});

	it("returns 401 without an API key", async () => {
		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/faces/${FACE_ID}`,
			{ method: "DELETE" },
		);

		expect(res.status).toBe(401);
	});
});

describe("POST /albums/:externalClientAlbumId/upload-url", () => {
	it("returns 200 with uploadUrl and key when album exists", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/upload-url`,
			{
				method: "POST",
				headers: authHeaders,
				body: JSON.stringify({}),
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
		mockGetAlbum.mockResolvedValue(null);

		const res = await pictureAlbumManagementRoute.request(
			`/albums/${VALID_UUID}/upload-url`,
			{
				method: "POST",
				headers: authHeaders,
				body: JSON.stringify({}),
			},
		);

		expect(res.status).toBe(404);
	});
});
