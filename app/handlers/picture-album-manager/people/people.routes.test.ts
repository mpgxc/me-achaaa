import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAlbum = vi.fn();

vi.mock("../picture-album-management.service", () => ({
	PictureAlbumManagementService: class {
		getAlbum = mockGetAlbum;
	},
}));

const mockListPeople = vi.fn();
const mockGetPersonPhotos = vi.fn();
const mockRebuild = vi.fn();

vi.mock("./person-clustering.service", () => ({
	PersonClusteringService: class {
		listPeople = mockListPeople;
		getPersonPhotos = mockGetPersonPhotos;
		rebuild = mockRebuild;
	},
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
const PERSON_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-1";
const headers = {
	"Content-Type": "application/json",
	Authorization: "Bearer test-key",
};

const { peopleManagementRoute } = await import("./people.routes");

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveTenant.mockResolvedValue({ id: TENANT_ID });
	mockGetAlbum.mockResolvedValue({ tenantId: TENANT_ID, content: {} });
});

describe("GET /albums/{id}/people", () => {
	it("returns 401 without an API key", async () => {
		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people`,
		);

		expect(res.status).toBe(401);
	});

	it("returns 404 when the album belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other", content: {} });

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people`,
			{ headers },
		);

		expect(res.status).toBe(404);
		expect(mockListPeople).not.toHaveBeenCalled();
	});

	it("returns 200 with the people and a cacheable Cache-Control", async () => {
		mockListPeople.mockResolvedValue([
			{
				personId: "p1",
				coverFaceId: "p1",
				coverKey: "uploads/faces/col/p1.jpg",
				faceCount: 3,
				photoCount: 2,
			},
		]);

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people`,
			{ headers },
		);

		expect(res.status).toBe(200);
		expect((await res.json()).people).toHaveLength(1);
		expect(res.headers.get("Cache-Control")).toContain("max-age");
	});
});

describe("GET /albums/{id}/people/{personId}/photos", () => {
	it("returns 200 with the person's photos", async () => {
		mockGetPersonPhotos.mockResolvedValue({
			personId: PERSON_UUID,
			images: ["img-1", "img-2"],
		});

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people/${PERSON_UUID}/photos`,
			{ headers },
		);

		expect(res.status).toBe(200);
		expect((await res.json()).images).toEqual(["img-1", "img-2"]);
	});

	it("returns 404 when the person does not exist", async () => {
		mockGetPersonPhotos.mockResolvedValue(null);

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people/${PERSON_UUID}/photos`,
			{ headers },
		);

		expect(res.status).toBe(404);
	});
});

describe("POST /albums/{id}/people/rebuild", () => {
	it("returns 200 with the rebuild summary", async () => {
		mockRebuild.mockResolvedValue({ people: 2, faces: 5 });

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people/rebuild`,
			{ method: "POST", headers },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ people: 2, faces: 5 });
	});

	it("returns 404 when the album belongs to another tenant", async () => {
		mockGetAlbum.mockResolvedValue({ tenantId: "other", content: {} });

		const res = await peopleManagementRoute.request(
			`/albums/${VALID_UUID}/people/rebuild`,
			{ method: "POST", headers },
		);

		expect(res.status).toBe(404);
		expect(mockRebuild).not.toHaveBeenCalled();
	});
});
