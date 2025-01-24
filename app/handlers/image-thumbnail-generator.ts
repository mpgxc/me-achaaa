import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import { S3Singleton } from "../providers";

const generateThumbnailWithWatermark = async (image: Uint8Array) => {
	const WATERMARK_FILE_PATH = path.resolve(
		__dirname,
		"../assets/watermark.png",
	);
	const RESIZE_FACTOR = 0.3;
	const WATERMARK_SIZE_FACTOR = 0.05;

	const metadata = await sharp(image).metadata();

	if (!metadata.width || !metadata.height) {
		console.warn("GenerateThumbnailWithWatermark: Invalid Image Metadata");

		return null;
	}

	const watermark = await sharp(await fs.readFile(WATERMARK_FILE_PATH))
		.resize({
			width: Math.round(metadata.width * WATERMARK_SIZE_FACTOR),
			height: Math.round(metadata.height * WATERMARK_SIZE_FACTOR),
			fit: "inside",
		})
		.toBuffer();

	return sharp(image)
		.resize({
			width: Math.round(metadata.width * RESIZE_FACTOR),
			height: Math.round(metadata.height * RESIZE_FACTOR),
			fit: "inside",
		})
		.composite([
			{
				input: watermark,
				tile: true,
				gravity: "southeast",
			},
		])
		.toFormat("jpg")
		.toBuffer();
};

const getImageFromBucket = async (Key: string): Promise<Uint8Array | null> => {
	const command = new GetObjectCommand({
		Key,
		Bucket: s3Client.bucketName,
	});

	const { Body } = await s3Client.send(command);

	return Body?.transformToByteArray() ?? null;
};

const s3Client = S3Singleton.getInstance();

export const handler = async ({
	Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	for (const { body, messageId } of Records) {
		try {
			const { images } = JSON.parse(body) as {
				images: Array<string>;
			};

			await processImagesHandler(images);
		} catch (error) {
			console.error(
				`Handler: Failed to process message ${messageId}: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
			);

			batchItemFailures.push({ itemIdentifier: messageId });
		}
	}

	return { batchItemFailures };
};

const processImagesHandler = async (images: Array<string>) => {
	for (const key of images) {
		const image = await getImageFromBucket(key);

		if (!image) {
			console.warn(`ImageThumbnailGenerator: Image not found: ${key}`);

			continue;
		}

		const thumbnail = await generateThumbnailWithWatermark(image);

		if (!thumbnail) {
			console.warn(
				`ImageThumbnailGenerator: Error generating thumbnail: ${key}`,
			);

			continue;
		}

		{
			const command = new PutObjectCommand({
				Key: key.replace("uploads/incoming/", "uploads/thumbnails/"),
				Bucket: s3Client.bucketName,
				Body: thumbnail,
				ContentType: "image/jpeg",
			});

			await s3Client.send(command);
		}
	}
};
