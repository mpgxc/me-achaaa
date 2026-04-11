import { describe, expect, it } from "vitest";
import { extractExternalImageId } from "./picture-index-processing";

describe("extractExternalImageId (picture-index-processing)", () => {
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

	it("handles UUID-based keys", () => {
		const result = extractExternalImageId(
			"uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/photo-001.jpg",
		);

		expect(result.CollectionId).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
		expect(result.ExternalImageId).toBe("photo-001");
	});
});
