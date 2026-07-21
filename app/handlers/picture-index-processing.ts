import {
	type TransactWriteItem,
	TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
	type Face,
	type FaceDetail,
	IndexFacesCommand,
} from "@aws-sdk/client-rekognition";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { marshall } from "@aws-sdk/util-dynamodb";
import type {
	S3Event,
	S3EventRecord,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { extractExternalImageId, splitBatches } from "../helpers/commons";
import { errorMessage, logger } from "../logger";
import {
	DynamoSingleton,
	RekognitionSingleton,
	SqsSingleton,
} from "../providers";
import type { ImageProcessingEvent, ImageProcessingFacesEvent } from "./types";

const TRANSACTIONS_LIMIT_PER_BATCH = 50;

const rekognition = RekognitionSingleton.getInstance();
const dynamodb = DynamoSingleton.getInstance();
const sqsClient = SqsSingleton.getInstance();

export { extractExternalImageId } from "../helpers/commons";

const rekognitionEventHandler = async ({
	bucket,
	object,
}: Pick<S3EventRecord["s3"], "bucket" | "object">): Promise<
	ImageProcessingFacesEvent[]
> => {
	const { ExternalImageId, CollectionId } = extractExternalImageId(object.key);

	const command = new IndexFacesCommand({
		CollectionId,
		Image: {
			S3Object: {
				Bucket: bucket.name,
				Name: object.key,
			},
		},
		MaxFaces: 5,
		QualityFilter: "HIGH",
		ExternalImageId,
		DetectionAttributes: ["ALL"],
	});

	// Sem try/catch aqui de propósito: um erro do Rekognition (throttle,
	// timeout) deve PROPAGAR para o handler marcar a mensagem como falha e o
	// SQS reprocessá-la. Engolir o erro e retornar [] causava perda silenciosa
	// (a imagem era confirmada como "sem faces" e nunca reindexada).
	const { FaceRecords } = await rekognition.send(command);

	if (!FaceRecords || !FaceRecords.length) {
		logger.warn("Rekognition: nenhuma face indexada", { key: object.key });

		return [];
	}

	logger.info("Rekognition: faces indexadas", {
		key: object.key,
		faces: FaceRecords.length,
	});

	return FaceRecords.flatMap(
		({ Face, FaceDetail }) =>
			({
				Face,
				FaceDetail,
			}) as ImageProcessingFacesEvent,
	);
};

export const handler = async ({
	Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	const images: Array<{
		key: string;
		faces: {
			Face: Face;
			FaceDetail: FaceDetail;
		}[];
	}> = [];

	for (const { body, messageId } of Records) {
		try {
			const { Records } = JSON.parse(body) as S3Event;

			const [
				{
					s3: { bucket, object },
				},
			] = Records;

			const faces = await rekognitionEventHandler({
				bucket,
				object,
			});

			if (!faces.length) {
				logger.warn("Handler: nenhuma face indexada", { key: object.key });
			}

			images.push({
				key: object.key,
				faces,
			});
		} catch (error) {
			// Falha ao indexar -> reprocessa a mensagem (não perde silenciosamente).
			logger.error("Handler: erro processando evento S3", {
				messageId,
				error: errorMessage(error),
			});

			batchItemFailures.push({
				itemIdentifier: messageId,
			});
		}
	}

	await registerImageMetadata(images).catch((error) => {
		logger.error("RegisterImageMetadata: erro ao registrar metadados", {
			error: errorMessage(error),
		});
	});

	if (images.length > 0) {
		await Promise.all([
			sqsClient.send(
				new SendMessageCommand({
					QueueUrl: sqsClient.queueUrl.THUMBNAIL,
					MessageBody: JSON.stringify({
						images: images.map(({ key }) => key),
					}),
				}),
			),
			sqsClient.send(
				new SendMessageCommand({
					QueueUrl: sqsClient.queueUrl.FACE_EXTRACT,
					MessageBody: JSON.stringify({
						images,
					}),
				}),
			),
		]);
	}

	return { batchItemFailures };
};

const registerImageMetadata = async (images: ImageProcessingEvent[]) => {
	const TransactItems = images.map(({ key, faces }) => {
		const { CollectionId, ExternalImageId } = extractExternalImageId(key);

		return {
			Put: {
				TableName: dynamodb.tableName,
				Item: marshall({
					PK: `ALBUM#${CollectionId}`,
					SK: `IMAGE#${ExternalImageId}`,
					ExternalImageId,
					Content: {
						thumbnail: `uploads/thumbnails/${CollectionId}/${ExternalImageId}.jpg`,
						original: `uploads/incoming/${CollectionId}/${ExternalImageId}.jpg`,
						faces: faces.map(
							({ Face }) => `uploads/faces/${CollectionId}/${Face.FaceId}.jpg`,
						),
					},
					CreatedAt: new Date().toISOString(),
				}),
			},
		};
	}) as TransactWriteItem[];

	const batches = splitBatches(TransactItems, TRANSACTIONS_LIMIT_PER_BATCH);

	for (const batch of batches) {
		const command = new TransactWriteItemsCommand({
			TransactItems: batch,
		});

		await dynamodb.send(command);
	}
};
