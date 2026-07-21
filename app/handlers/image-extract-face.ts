import {
	type TransactWriteItem,
	TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import type {
	BoundingBox,
	Face,
	FaceDetail,
} from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import { extractExternalImageId, splitBatches } from "../helpers/commons";
import { DynamoSingleton, S3Singleton, SqsSingleton } from "../providers";
import type { ImageProcessingEvent } from "./types";

const TRANSACTIONS_LIMIT_PER_BATCH = 50;

const dynamodb = DynamoSingleton.getInstance();
const s3Client = S3Singleton.getInstance();
const sqsClient = SqsSingleton.getInstance();

/**
 * Monta o evento de conclusão emitido quando as faces de uma imagem foram
 * extraídas. Consumido pelo NotificationDispatcher para chamar o webhook.
 */
export const buildProcessedNotification = (key: string, faceIds: string[]) => {
	const { CollectionId, ExternalImageId } = extractExternalImageId(key);

	return {
		type: "image.processed" as const,
		collectionId: CollectionId,
		imageId: ExternalImageId,
		faceIds,
	};
};

const emitProcessedNotifications = async (
	processed: Array<{ key: string; faceIds: string[] }>,
) => {
	const queueUrl = sqsClient.queueUrl.NOTIFICATION;

	if (!queueUrl) {
		return; // notificações desabilitadas se a fila não estiver configurada
	}

	await Promise.all(
		processed.map((item) =>
			sqsClient
				.send(
					new SendMessageCommand({
						QueueUrl: queueUrl,
						MessageBody: JSON.stringify(
							buildProcessedNotification(item.key, item.faceIds),
						),
					}),
				)
				.catch((error) => {
					console.error(
						`EmitProcessedNotifications: falha ao enfileirar notificação para ${item.key}: ${
							error instanceof Error ? error.message : JSON.stringify(error)
						}`,
					);
				}),
		),
	);
};

const getImageFromBucket = async (Key: string): Promise<Uint8Array | null> => {
	const command = new GetObjectCommand({
		Key,
		Bucket: s3Client.bucketName,
	});

	const { Body } = await s3Client.send(command);

	return Body?.transformToByteArray() ?? null;
};

export { extractExternalImageId } from "../helpers/commons";

export const extractFacePicturePolicy = (
	face: Face,
	faceDetail: FaceDetail,
) => {
	if (!face.BoundingBox || !face.Confidence) {
		return false;
	}

	if (face.Confidence < 99) {
		return false;
	}

	if (
		!faceDetail.Quality ||
		!faceDetail.Quality.Brightness ||
		!faceDetail.Quality.Sharpness
	) {
		return false;
	}

	if (faceDetail.Quality.Sharpness < 60 || faceDetail.Quality.Brightness < 60) {
		return false;
	}

	return true;
};

type ExtractFacePictureOutput = {
	CollectionId: string;
	faces: Face[];
};

const extractFacePicture = async ({
	faces,
	key,
}: ImageProcessingEvent): Promise<ExtractFacePictureOutput | null> => {
	try {
		const { CollectionId } = extractExternalImageId(key);

		const filteredFaces: ExtractFacePictureOutput = {
			CollectionId,
			faces: [],
		};

		for (const { Face, FaceDetail } of faces) {
			if (!extractFacePicturePolicy(Face, FaceDetail)) {
				console.info(`ExtractFacePicture: Face not extracted: ${Face.FaceId}`);
				console.table({ Face, FaceDetail });

				continue;
			}

			const { Left, Top, Width, Height } =
				Face.BoundingBox as Required<BoundingBox>;

			const image = await getImageFromBucket(key);

			if (!image) {
				console.warn(`ExtractFacePicture: Image not found: ${key}`);

				continue;
			}

			const metadata = await sharp(image).metadata();

			if (!metadata.width || !metadata.height) {
				console.warn(`ExtractFacePicture: Image metadata not found: ${key}`);

				continue;
			}

			const paddingPercentage = 0.03; // 3% do tamanho da imagem
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

			const cropped = await sharp(image)
				.extract(params)
				.toFormat("jpg")
				.toBuffer();

			{
				const command = new PutObjectCommand({
					Bucket: s3Client.bucketName,
					Key: `uploads/faces/${CollectionId}/${Face.FaceId}.jpg`,
					Body: cropped,
					ContentType: "image/jpeg",
				});

				await s3Client.send(command);
			}

			filteredFaces.faces.push(Face);
		}

		return filteredFaces;
	} catch (error) {
		console.error(
			`ExtractFacePicture: Error processing S3 event: ${JSON.stringify(
				error,
				null,
				2,
			)}`,
		);

		return null;
	}
};

export const handler = async ({
	Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	for (const { body, messageId } of Records) {
		try {
			const { images } = JSON.parse(body) as {
				images: ImageProcessingEvent[];
			};

			await processImagesHandler(images);
		} catch (error) {
			console.error(
				`Handler: Failed to process message ${messageId}: ${
					error instanceof Error ? error.message : JSON.stringify(error)
				}`,
			);

			batchItemFailures.push({ itemIdentifier: messageId });
		}
	}

	return { batchItemFailures };
};

const processImagesHandler = async (images: ImageProcessingEvent[]) => {
	const faces: ExtractFacePictureOutput[] = [];
	const processed: Array<{ key: string; faceIds: string[] }> = [];

	for (const content of images) {
		try {
			const filteredFaces = await extractFacePicture(content);

			if (!filteredFaces) {
				continue;
			}

			faces.push(filteredFaces);
			processed.push({
				key: content.key,
				faceIds: filteredFaces.faces
					.map(({ FaceId }) => FaceId)
					.filter((id): id is string => Boolean(id)),
			});
		} catch (error) {
			console.error(
				`ProcessImagesHandler: Error processing image ${content.key}: ${
					error instanceof Error ? error.message : JSON.stringify(error)
				}`,
			);

			throw error;
		}
	}

	await registerFacesImageMetadata(faces);
	await emitProcessedNotifications(processed);
};

const registerFacesImageMetadata = async (
	images: Array<{
		CollectionId: string;
		faces: Face[];
	}>,
) => {
	const TransactItems = [] as TransactWriteItem[];

	for (const { CollectionId, faces } of images) {
		const output = faces.map(
			({ FaceId, ImageId, ExternalImageId, Confidence }) =>
				({
					Put: {
						TableName: dynamodb.tableName,
						Item: marshall({
							PK: `ALBUM#${CollectionId}`,
							SK: `FACE#${FaceId}`,
							FaceId,
							ImageId,
							Confidence,
							CollectionId,
							ExternalImageId,
							CreatedAt: new Date().toISOString(),
						}),
					},
				}) as TransactWriteItem,
		);

		TransactItems.push(...output);
	}

	const batches = splitBatches(TransactItems, TRANSACTIONS_LIMIT_PER_BATCH);

	for (const batch of batches) {
		const command = new TransactWriteItemsCommand({
			TransactItems: batch,
		});

		await dynamodb.send(command);
	}
};
