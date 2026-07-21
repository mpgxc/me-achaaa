import type { RekognitionClient } from "@aws-sdk/client-rekognition";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PictureSearchService } from "./picture-search.service";

const mockSend = vi.fn();

vi.mock("../../../providers", () => ({
	RekognitionSingleton: { getInstance: () => ({ send: mockSend }) },
}));

describe("PictureSearchService", () => {
	let service: PictureSearchService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new PictureSearchService({
			send: mockSend,
		} as unknown as RekognitionClient);
	});

	describe("countFaces", () => {
		it("returns the number of detected faces", async () => {
			mockSend.mockResolvedValue({ FaceDetails: [{}, {}] });

			expect(await service.countFaces(Buffer.from("x"))).toBe(2);
		});

		it("returns 0 when no faces are detected", async () => {
			mockSend.mockResolvedValue({ FaceDetails: [] });

			expect(await service.countFaces(Buffer.from("x"))).toBe(0);
		});
	});

	describe("searchByImage", () => {
		it("maps ExternalImageId and drops matches without one", async () => {
			mockSend.mockResolvedValue({
				FaceMatches: [
					{ Face: { ExternalImageId: "img-1" } },
					{ Face: {} },
					{ Face: { ExternalImageId: "img-2" } },
				],
			});

			expect(await service.searchByImage("col", Buffer.from("x"))).toEqual([
				"img-1",
				"img-2",
			]);
		});
	});

	describe("searchByFaceId", () => {
		it("maps matches to the public shape", async () => {
			mockSend.mockResolvedValue({
				FaceMatches: [
					{ Face: { FaceId: "f2", ExternalImageId: "img-5" }, Similarity: 98 },
				],
			});

			expect(await service.searchByFaceId("col", "f1")).toEqual([
				{ faceId: "f2", externalImageId: "img-5", similarity: 98 },
			]);
		});

		it("returns an empty array when there are no matches", async () => {
			mockSend.mockResolvedValue({ FaceMatches: [] });

			expect(await service.searchByFaceId("col", "f1")).toEqual([]);
		});
	});
});
