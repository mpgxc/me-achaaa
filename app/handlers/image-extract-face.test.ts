import type { Face, FaceDetail } from "@aws-sdk/client-rekognition";
import { describe, expect, it } from "vitest";
import {
	extractExternalImageId,
	extractFacePicturePolicy,
} from "./image-extract-face";

describe("extractExternalImageId", () => {
	it("parses collectionId and imageId from a .jpg key", () => {
		const result = extractExternalImageId(
			"uploads/incoming/collection-abc/image-123.jpg",
		);

		expect(result.CollectionId).toBe("collection-abc");
		expect(result.ExternalImageId).toBe("image-123");
	});

	it("parses collectionId and imageId from a .jpeg key", () => {
		const result = extractExternalImageId(
			"uploads/incoming/collection-abc/image-123.jpeg",
		);

		expect(result.CollectionId).toBe("collection-abc");
		expect(result.ExternalImageId).toBe("image-123");
	});

	it("handles UUID-based collectionId and imageId", () => {
		const result = extractExternalImageId(
			"uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/a1b2c3d4-0000-0000-0000-000000000000.jpg",
		);

		expect(result.CollectionId).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
		expect(result.ExternalImageId).toBe("a1b2c3d4-0000-0000-0000-000000000000");
	});
});

describe("extractFacePicturePolicy", () => {
	const makeFace = (overrides: Partial<Face> = {}): Face => ({
		FaceId: "face-1",
		BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.5, Height: 0.5 },
		Confidence: 99.5,
		...overrides,
	});

	const makeFaceDetail = (overrides: Partial<FaceDetail> = {}): FaceDetail => ({
		Quality: { Brightness: 75, Sharpness: 80 },
		...overrides,
	});

	it("returns true for a high-quality face", () => {
		expect(extractFacePicturePolicy(makeFace(), makeFaceDetail())).toBe(true);
	});

	it("returns false when BoundingBox is missing", () => {
		expect(
			extractFacePicturePolicy(
				makeFace({ BoundingBox: undefined }),
				makeFaceDetail(),
			),
		).toBe(false);
	});

	it("returns false when Confidence is missing", () => {
		expect(
			extractFacePicturePolicy(
				makeFace({ Confidence: undefined }),
				makeFaceDetail(),
			),
		).toBe(false);
	});

	it("returns false when Confidence is below 99", () => {
		expect(
			extractFacePicturePolicy(
				makeFace({ Confidence: 98.9 }),
				makeFaceDetail(),
			),
		).toBe(false);
	});

	it("returns false when Quality is missing", () => {
		expect(
			extractFacePicturePolicy(
				makeFace(),
				makeFaceDetail({ Quality: undefined }),
			),
		).toBe(false);
	});

	it("returns false when Sharpness is below 60", () => {
		expect(
			extractFacePicturePolicy(
				makeFace(),
				makeFaceDetail({ Quality: { Brightness: 75, Sharpness: 59 } }),
			),
		).toBe(false);
	});

	it("returns false when Brightness is below 60", () => {
		expect(
			extractFacePicturePolicy(
				makeFace(),
				makeFaceDetail({ Quality: { Brightness: 59, Sharpness: 80 } }),
			),
		).toBe(false);
	});

	it("returns true at exactly the minimum Sharpness and Brightness thresholds", () => {
		expect(
			extractFacePicturePolicy(
				makeFace(),
				makeFaceDetail({ Quality: { Brightness: 60, Sharpness: 60 } }),
			),
		).toBe(true);
	});
});
