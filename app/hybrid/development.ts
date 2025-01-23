import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { RekognitionSingleton, S3Singleton } from "../providers";

const reko = RekognitionSingleton.getInstance();
const s3c = S3Singleton.getInstance();

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

		const paddingPercentage = 0.0001; // 3% do tamanho da imagem
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

const generateThumbnail = async (image: Uint8Array): Promise<Uint8Array> => {
	const thumbnail = await sharp(image)
		.resize({ width: 256, height: 256, fit: "inside" })
		.toBuffer();

	return thumbnail;
};

const generateThumbnailWithWaterMark = async (image: Uint8Array) => {
	const watermarkPath = await readFile(`${__dirname}/watermark.png`);

	const metadata = await sharp(image).metadata();

	if (!metadata.width || !metadata.height) {
		return;
	}

	await sharp(image)
		.resize({
			width: Math.round(metadata?.width - 0.8 * metadata?.width),
			height: Math.round(metadata?.height - 0.8 * metadata?.height),
			fit: "inside",
		})
		.composite([
			{
				input: await sharp(watermarkPath).resize(100, 100).toBuffer(),
				tile: true,
				gravity: "southeast",
			},
		])
		.toFormat("jpeg")
		.toFile("output.jpg");
};

async function generatePictureThumbnail(Key: string) {}

(async () => {
	await extractFaceFromPicture(
		"uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/5.jpg",
	);

	const command = new GetObjectCommand({
		Key: "uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/5.jpg",
		Bucket: s3c.bucketName,
	});

	const { Body } = await s3c.send(command);

	const image = await Body?.transformToByteArray();

	await generateThumbnailWithWaterMark(image as Uint8Array);
})();
