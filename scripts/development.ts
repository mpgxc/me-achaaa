import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { RekognitionSingleton, S3Singleton } from "../app/providers";

const reko = RekognitionSingleton.getInstance();
const s3c = S3Singleton.getInstance();

import {
	CreateCollectionCommand,
	DeleteCollectionCommand,
	type Face,
	type FaceMatch,
	IndexFacesCommand,
	ListCollectionsCommand,
	ListFacesCommand,
	SearchFacesByImageCommand,
	SearchFacesCommand,
} from "@aws-sdk/client-rekognition";

async function listFacesInCollection(collectionId: string): Promise<Face[]> {
	const command = new ListFacesCommand({
		CollectionId: collectionId,
	});

	const { Faces } = await reko.send(command);

	return Faces?.length ? Faces : [];
}

async function listCollections(): Promise<string[]> {
	const command = new ListCollectionsCommand();

	const { CollectionIds } = await reko.send(command);

	return CollectionIds || [];
}

async function faceSearchByFaceId(
	FaceId: string,
	CollectionId: string,
): Promise<FaceMatch[]> {
	const command = new SearchFacesCommand({
		FaceId,
		CollectionId,
		FaceMatchThreshold: 90,
	});

	const { FaceMatches } = await reko.send(command);

	if (!FaceMatches?.length) {
		return [];
	}

	return FaceMatches;
}

async function indexFaces(
	CollectionId: string,
	ExternalImageId: string,
	Bytes: Buffer,
): Promise<Face[]> {
	const command = new IndexFacesCommand({
		Image: {
			Bytes,
		},
		CollectionId,
		ExternalImageId,
		DetectionAttributes: ["ALL"],
	});

	const { FaceRecords } = await reko.send(command);

	return FaceRecords?.length
		? FaceRecords?.flatMap(({ Face }) => Face ?? [])
		: [];
}

async function deleteCollection(CollectionId: string): Promise<void> {
	const command = new DeleteCollectionCommand({
		CollectionId,
	});

	await reko.send(command);
}

async function createCollection(CollectionId: string): Promise<void> {
	const command = new CreateCollectionCommand({
		CollectionId,
	});

	await reko.send(command);
}

async function faceSearchByImage(
	CollectionId: string,
	Bytes: Buffer,
): Promise<FaceMatch[]> {
	const command = new SearchFacesByImageCommand({
		CollectionId,
		Image: {
			Bytes,
		},
		FaceMatchThreshold: 90,
	});

	const { FaceMatches } = await reko.send(command);

	if (!FaceMatches?.length) {
		return [];
	}

	return FaceMatches;
}

async function extractFaceFromPicture(Key: string) {
	const command = new GetObjectCommand({
		Key,
		Bucket: s3c.bucketName,
	});

	const { Body } = await s3c.send(command);
	const image = await Body?.transformToByteArray();
	const metadata = await sharp(image).metadata();

	if (!metadata.width || !metadata.height) {
		return [];
	}

	const { FaceDetails } = await reko.send(
		new DetectFacesCommand({
			Image: {
				Bytes: image,
			},
		}),
	);

	if (!FaceDetails?.length) {
		return [];
	}

	for (const { BoundingBox, Confidence, Quality } of FaceDetails) {
		if (!BoundingBox || !Confidence) {
			continue;
		}

		if (!Quality || !Quality.Brightness || !Quality.Sharpness) {
			continue;
		}

		if (Confidence < 99) {
			continue;
		}

		if (Quality.Sharpness < 60 || Quality.Brightness < 60) {
			console.warn("Low Quality Image: ", Quality);

			continue;
		}

		const { Height, Width, Left, Top } = BoundingBox as Required<
			typeof BoundingBox
		>;

		const paddingPercentage = 0.0001; // 0.01% do tamanho da imagem
		const paddingWidth = Math.round(metadata.width * paddingPercentage);
		const paddingHeight = Math.round(metadata.height * paddingPercentage);

		const params = {
			left: Math.max(0, Math.round(Left * metadata.width) - paddingWidth),
			top: Math.max(0, Math.round(Top * metadata.height) - paddingHeight),
			width: Math.min(
				metadata.width,
				Math.round(Width * metadata.width) + 2 * paddingWidth,
			),
			height: Math.min(
				metadata.height,
				Math.round(Height * metadata.height) + 2 * paddingHeight,
			),
		};

		const destination = `outputs/${randomUUID()}_Sharpness--${
			Quality?.Sharpness
		}_Brightness--${Quality?.Brightness}_Confidence-${Confidence}.jpg`;

		await sharp(image).extract(params).toFormat("jpg").toFile(destination);
	}
}

const generateThumbnailWithWatermark = async (image: Uint8Array) => {
	const WATERMARK_FILE_PATH = `${__dirname}/watermark.png`;
	const RESIZE_FACTOR = 0.3;
	const WATERMARK_SIZE_FACTOR = 0.05;

	const metadata = await sharp(image).metadata();

	if (!metadata.width || !metadata.height) {
		console.warn("GenerateThumbnailWithWatermark: Invalid Image Metadata");

		return null;
	}

	const watermark = await sharp(await fs.promises.readFile(WATERMARK_FILE_PATH))
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
		.toFormat("jpeg");
};

(async () => {
	const command = new GetObjectCommand({
		Key: "uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/5.jpg",
		Bucket: s3c.bucketName,
	});

	const { Body } = await s3c.send(command);

	const image = await Body?.transformToByteArray();

	const thumbnail = await generateThumbnailWithWatermark(image as Uint8Array);
	if (thumbnail) {
		thumbnail.toFile("output.jpg");
	} else {
		console.error("Failed to generate thumbnail.");
	}
})();
