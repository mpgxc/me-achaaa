import type { APIGatewayProxyEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRekognitionSend = vi.fn();

vi.mock("../providers", () => ({
	RekognitionSingleton: {
		getInstance: () => ({ send: mockRekognitionSend }),
	},
}));

// Import after mock is set up
const { handler, handlerByFaceId } = await import("./picture-search");

const makeEvent = (
	overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent =>
	({
		headers: { "x-collection-id": "col-1" },
		body: null,
		...overrides,
	}) as unknown as APIGatewayProxyEvent;

describe("handler (search by image)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 400 when x-collection-id header is missing", async () => {
		const event = makeEvent({ headers: {} });
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		expect(JSON.parse(result.body).message).toContain("x-collection-id");
	});

	it("returns 400 when body is missing", async () => {
		const event = makeEvent({ body: null });
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
	});

	it("returns 413 when payload exceeds 5 MB", async () => {
		const bigBody = "A".repeat(5 * 1024 * 1024 + 1);
		const event = makeEvent({ body: bigBody });
		const result = await handler(event);

		expect(result.statusCode).toBe(413);
	});

	it("returns 400 when no faces are detected in the image", async () => {
		mockRekognitionSend.mockResolvedValueOnce({ FaceDetails: [] });

		const event = makeEvent({
			body: Buffer.from("fake-image-bytes").toString("base64"),
		});
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		expect(JSON.parse(result.body).message).toContain("face");
	});

	it("returns 400 when more than one face is detected", async () => {
		mockRekognitionSend.mockResolvedValueOnce({
			FaceDetails: [{}, {}],
		});

		const event = makeEvent({
			body: Buffer.from("fake-image-bytes").toString("base64"),
		});
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
	});

	it("returns 200 with matched images when exactly one face is found", async () => {
		mockRekognitionSend
			.mockResolvedValueOnce({ FaceDetails: [{}] }) // DetectFaces
			.mockResolvedValueOnce({
				FaceMatches: [
					{ Face: { ExternalImageId: "img-1" } },
					{ Face: { ExternalImageId: "img-2" } },
				],
			}); // SearchFacesByImage

		const event = makeEvent({
			body: Buffer.from("fake-image-bytes").toString("base64"),
		});
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body).images).toEqual(["img-1", "img-2"]);
	});
});

describe("handlerByFaceId (search by face ID)", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns 400 when x-collection-id header is missing", async () => {
		const event = makeEvent({
			headers: {},
			body: JSON.stringify({ faceId: "f1" }),
		});
		const result = await handlerByFaceId(event);

		expect(result.statusCode).toBe(400);
		expect(JSON.parse(result.body).message).toContain("x-collection-id");
	});

	it("returns 400 when body is missing", async () => {
		const event = makeEvent({ body: null });
		const result = await handlerByFaceId(event);

		expect(result.statusCode).toBe(400);
	});

	it("returns 400 when faceId is missing in body", async () => {
		const event = makeEvent({ body: JSON.stringify({}) });
		const result = await handlerByFaceId(event);

		expect(result.statusCode).toBe(400);
		expect(JSON.parse(result.body).message).toContain("faceId");
	});

	it("returns 200 with matches when faceId is valid", async () => {
		mockRekognitionSend.mockResolvedValueOnce({
			FaceMatches: [
				{ Face: { FaceId: "f2", ExternalImageId: "img-5" }, Similarity: 98.0 },
			],
		});

		const event = makeEvent({ body: JSON.stringify({ faceId: "f1" }) });
		const result = await handlerByFaceId(event);

		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);

		expect(body.matches).toHaveLength(1);
		expect(body.matches[0].faceId).toBe("f2");
		expect(body.matches[0].similarity).toBe(98.0);
	});

	it("returns 200 with empty matches when no faces are found", async () => {
		mockRekognitionSend.mockResolvedValueOnce({ FaceMatches: [] });

		const event = makeEvent({ body: JSON.stringify({ faceId: "f1" }) });
		const result = await handlerByFaceId(event);

		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body).matches).toEqual([]);
	});
});
