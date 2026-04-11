import type { SQSEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockS3Send = vi.fn();
const mockSharpInstance = {
	metadata: vi.fn(),
	resize: vi.fn(),
	composite: vi.fn(),
	toFormat: vi.fn(),
	toBuffer: vi.fn(),
};

// Chain all sharp methods back to the same mock object
for (const key of Object.keys(mockSharpInstance) as Array<
	keyof typeof mockSharpInstance
>) {
	if (key !== "metadata" && key !== "toBuffer") {
		(mockSharpInstance[key] as ReturnType<typeof vi.fn>).mockReturnValue(
			mockSharpInstance,
		);
	}
}

vi.mock("sharp", () => ({
	default: vi.fn(() => mockSharpInstance),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue(Buffer.from("watermark")),
	},
}));

vi.mock("../providers", () => ({
	S3Singleton: {
		getInstance: () => ({
			send: mockS3Send,
			bucketName: "test-bucket",
		}),
	},
}));

const { handler } = await import("./image-thumbnail-generator");

const makeSQSEvent = (bodies: Array<{ images: string[] }>): SQSEvent => ({
	Records: bodies.map((body, i) => ({
		messageId: `msg-${i}`,
		body: JSON.stringify(body),
		receiptHandle: "",
		attributes: {} as never,
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "",
		awsRegion: "us-east-1",
	})),
});

describe("ImageThumbnailGenerator handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Reset chaining mocks
		for (const key of Object.keys(mockSharpInstance) as Array<
			keyof typeof mockSharpInstance
		>) {
			if (key !== "metadata" && key !== "toBuffer") {
				(mockSharpInstance[key] as ReturnType<typeof vi.fn>).mockReturnValue(
					mockSharpInstance,
				);
			}
		}
	});

	it("returns empty batchItemFailures when all messages succeed", async () => {
		const imageBytes = Buffer.from("fake-image");

		mockS3Send.mockResolvedValueOnce({
			Body: { transformToByteArray: () => imageBytes },
		});

		mockSharpInstance.metadata.mockResolvedValue({ width: 1000, height: 800 });
		mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("thumbnail"));

		mockS3Send.mockResolvedValueOnce({});

		const event = makeSQSEvent([
			{ images: ["uploads/incoming/album-1/photo-1.jpg"] },
		]);

		const result = await handler(event);

		expect(result.batchItemFailures).toHaveLength(0);
	});

	it("adds to batchItemFailures when a message throws", async () => {
		mockS3Send.mockRejectedValueOnce(new Error("S3 error"));

		const event = makeSQSEvent([
			{ images: ["uploads/incoming/album-1/photo-1.jpg"] },
		]);

		const result = await handler(event);

		expect(result.batchItemFailures).toHaveLength(1);
		expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-0");
	});

	it("skips an image when S3 returns no body", async () => {
		mockS3Send.mockResolvedValueOnce({
			Body: { transformToByteArray: () => null },
		});

		const event = makeSQSEvent([
			{ images: ["uploads/incoming/album-1/photo-1.jpg"] },
		]);

		const result = await handler(event);

		expect(result.batchItemFailures).toHaveLength(0);
		// No PutObject call since image was null
		expect(mockS3Send).toHaveBeenCalledTimes(1);
	});

	it("stores thumbnail under uploads/thumbnails/ path", async () => {
		const imageBytes = Buffer.from("fake-image");

		mockS3Send.mockResolvedValueOnce({
			Body: { transformToByteArray: () => imageBytes },
		});

		mockSharpInstance.metadata.mockResolvedValue({ width: 1000, height: 800 });
		mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from("thumbnail"));

		mockS3Send.mockResolvedValueOnce({});

		const event = makeSQSEvent([
			{ images: ["uploads/incoming/album-1/photo-1.jpg"] },
		]);

		await handler(event);

		const putCall = mockS3Send.mock.calls[1][0];
		expect(putCall.input.Key).toBe("uploads/thumbnails/album-1/photo-1.jpg");
		expect(putCall.input.Bucket).toBe("test-bucket");
	});
});
