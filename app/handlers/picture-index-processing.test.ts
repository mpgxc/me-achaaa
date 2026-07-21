import type { SQSEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRekoSend = vi.fn();
const mockDynamoSend = vi.fn();
const mockSqsSend = vi.fn();

vi.mock("../providers", () => ({
	RekognitionSingleton: { getInstance: () => ({ send: mockRekoSend }) },
	DynamoSingleton: {
		getInstance: () => ({ send: mockDynamoSend, tableName: "test-table" }),
	},
	SqsSingleton: {
		getInstance: () => ({
			send: mockSqsSend,
			queueUrl: { THUMBNAIL: "thumb-url", FACE_EXTRACT: "face-url" },
		}),
	},
}));

const { extractExternalImageId, handler } = await import(
	"./picture-index-processing"
);

const s3Body = JSON.stringify({
	Records: [
		{
			s3: {
				bucket: { name: "bucket" },
				object: { key: "uploads/incoming/col/img.jpg" },
			},
		},
	],
});

const makeSqsEvent = (messageId: string): SQSEvent =>
	({ Records: [{ body: s3Body, messageId }] }) as unknown as SQSEvent;

beforeEach(() => vi.clearAllMocks());

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

describe("handler", () => {
	it("marks the message for retry when IndexFaces throws (no silent loss)", async () => {
		mockRekoSend.mockRejectedValue(new Error("Rekognition throttled"));

		const res = await handler(makeSqsEvent("m1"));

		expect(res.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
		// Numa falha não deve haver fan-out para thumbnail/face-extract.
		expect(mockSqsSend).not.toHaveBeenCalled();
	});

	it("acks and fans out to the thumbnail + face-extract queues on success", async () => {
		mockRekoSend.mockResolvedValue({
			FaceRecords: [{ Face: { FaceId: "f1" }, FaceDetail: {} }],
		});
		mockDynamoSend.mockResolvedValue({});
		mockSqsSend.mockResolvedValue({});

		const res = await handler(makeSqsEvent("m2"));

		expect(res.batchItemFailures).toEqual([]);
		expect(mockSqsSend).toHaveBeenCalledTimes(2);
	});

	it("acks without failure when there are genuinely no faces", async () => {
		mockRekoSend.mockResolvedValue({ FaceRecords: [] });
		mockDynamoSend.mockResolvedValue({});
		mockSqsSend.mockResolvedValue({});

		const res = await handler(makeSqsEvent("m3"));

		expect(res.batchItemFailures).toEqual([]);
	});
});
