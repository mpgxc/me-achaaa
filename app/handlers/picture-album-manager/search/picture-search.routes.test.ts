import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAlbum = vi.fn();

vi.mock("../picture-album-management.service", () => ({
	PictureAlbumManagementService: class {
		getAlbum = mockGetAlbum;
	},
}));

const mockCountFaces = vi.fn();
const mockSearchByImage = vi.fn();
const mockSearchByFaceId = vi.fn();

vi.mock("./picture-search.service", () => ({
	PictureSearchService: class {
		countFaces = mockCountFaces;
		searchByImage = mockSearchByImage;
		searchByFaceId = mockSearchByFaceId;
	},
}));

const mockCacheGet = vi.fn();
const mockCachePut = vi.fn();

vi.mock("./search-cache.service", () => ({
	SearchCacheService: class {
		get = mockCacheGet;
		put = mockCachePut;
	},
	hashImage: () => "test-hash",
}));

const mockResolveTenant = vi.fn();

vi.mock("../auth/tenant.service", () => ({
	TenantService: class {
		resolveTenant = mockResolveTenant;
	},
}));

vi.mock("../../../providers", () => ({
	RekognitionSingleton: { getInstance: () => ({ send: vi.fn() }) },
	DynamoSingleton: { getInstance: () => ({ send: vi.fn(), tableName: "t" }) },
	S3Singleton: { getInstance: () => ({ send: vi.fn(), bucketName: "b" }) },
}));

const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const TENANT_ID = "tenant-1";
const IMAGE_B64 = Buffer.from("fake-image-bytes").toString("base64");
const headers = {
	"Content-Type": "application/json",
	Authorization: "Bearer test-key",
	"x-collection-id": VALID_UUID,
};

const { pictureSearchRoute } = await import("./picture-search.routes");

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveTenant.mockResolvedValue({ id: TENANT_ID });
	mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
	mockCacheGet.mockResolvedValue(null); // default: cache miss
	mockCachePut.mockResolvedValue(undefined);
});

describe("POST /search", () => {
	it("returns 401 without an API key", async () => {
		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-collection-id": VALID_UUID,
			},
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(401);
	});

	it("returns 400 when the x-collection-id header is missing", async () => {
		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-key",
			},
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(400);
	});

	it("returns 404 when the collection belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other-tenant", content: {} });

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(404);
		expect(mockCountFaces).not.toHaveBeenCalled();
	});

	it("returns 400 when no face is detected", async () => {
		mockCountFaces.mockResolvedValue(0);

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(400);
	});

	it("returns 400 when more than one face is detected", async () => {
		mockCountFaces.mockResolvedValue(2);

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(400);
	});

	it("returns 200 with matched images when exactly one face is found", async () => {
		mockCountFaces.mockResolvedValue(1);
		mockSearchByImage.mockResolvedValue(["img-1", "img-2"]);

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(200);
		expect((await res.json()).images).toEqual(["img-1", "img-2"]);
		expect(mockSearchByImage).toHaveBeenCalledWith(
			VALID_UUID,
			expect.any(Buffer),
		);
	});

	it("serves from cache without calling Rekognition on a hit", async () => {
		mockCacheGet.mockResolvedValue(["img-cached"]);

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(200);
		expect((await res.json()).images).toEqual(["img-cached"]);
		// Cache-hit não paga Rekognition: nem DetectFaces nem SearchFacesByImage.
		expect(mockCountFaces).not.toHaveBeenCalled();
		expect(mockSearchByImage).not.toHaveBeenCalled();
	});

	it("caches the result on a miss so the next identical search is free", async () => {
		mockCacheGet.mockResolvedValue(null);
		mockCountFaces.mockResolvedValue(1);
		mockSearchByImage.mockResolvedValue(["img-9"]);

		const res = await pictureSearchRoute.request("/search", {
			method: "POST",
			headers,
			body: JSON.stringify({ image: IMAGE_B64 }),
		});

		expect(res.status).toBe(200);
		expect(mockCachePut).toHaveBeenCalledWith(VALID_UUID, "test-hash", [
			"img-9",
		]);
	});
});

describe("POST /search/by-face-id", () => {
	it("returns 200 with matches", async () => {
		mockSearchByFaceId.mockResolvedValue([
			{ faceId: "f2", externalImageId: "img-5", similarity: 98 },
		]);

		const res = await pictureSearchRoute.request("/search/by-face-id", {
			method: "POST",
			headers,
			body: JSON.stringify({ faceId: "f1" }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.matches).toHaveLength(1);
		expect(body.matches[0].faceId).toBe("f2");
	});

	it("returns 404 when the collection belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other-tenant", content: {} });

		const res = await pictureSearchRoute.request("/search/by-face-id", {
			method: "POST",
			headers,
			body: JSON.stringify({ faceId: "f1" }),
		});

		expect(res.status).toBe(404);
		expect(mockSearchByFaceId).not.toHaveBeenCalled();
	});

	it("returns 400 when faceId is missing", async () => {
		const res = await pictureSearchRoute.request("/search/by-face-id", {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
	});
});
