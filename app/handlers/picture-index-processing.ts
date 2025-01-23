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
import { splitBatches } from "../helpers/commons";
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

const extractExternalImageId = (key: string) => {
	const [CollectionId, ExternalImageId] = key
		.replace("uploads/incoming/", "")
		.replace(".jpg", "")
		.split("/");

	return {
		CollectionId,
		ExternalImageId,
	};
};

const rekognitionEventHandler = async ({
	bucket,
	object,
}: Pick<S3EventRecord["s3"], "bucket" | "object">): Promise<
	ImageProcessingFacesEvent[]
> => {
	try {
		const { ExternalImageId, CollectionId } = extractExternalImageId(
			object.key,
		);

		const command = new IndexFacesCommand({
			CollectionId,
			Image: {
				S3Object: {
					Bucket: bucket.name,
					Name: object.key,
				},
			},
			MaxFaces: 3,
			QualityFilter: "HIGH",
			ExternalImageId,
			DetectionAttributes: ["ALL"],
		});

		const { FaceRecords } = await rekognition.send(command);

		if (!FaceRecords || !FaceRecords.length) {
			console.warn(
				`Rekognition: No faces were indexed for image ${object.key}`,
			);

			return [];
		}

		console.info(
			`Rekognition: ${FaceRecords?.length} faces indexed for image ${object.key}`,
		);

		return FaceRecords.flatMap(
			({ Face, FaceDetail }) =>
				({
					Face,
					FaceDetail,
				}) as ImageProcessingFacesEvent,
		);
	} catch (error) {
		console.error(
			`Rekognition: Error processing S3 event: ${
				error instanceof Error ? error.message : JSON.stringify(error)
			}`,
		);

		return [];
	}
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
				console.warn(`Handler: No faces were indexed for image: ${object.key}`);
			}

			images.push({
				key: object.key,
				faces,
			});
		} catch (error) {
			console.error(
				`Handler: Error processing S3 event: ${
					error instanceof Error ? error.message : JSON.stringify(error)
				}`,
			);

			batchItemFailures.push({
				itemIdentifier: messageId,
			});
		}
	}

	await registerImageMetadata(images).catch((error) => {
		console.error(
			`RegisterImageMetadata: Error registering image metadata: ${
				error instanceof Error ? error.message : JSON.stringify(error)
			}`,
		);
	});

	{
		const command = new SendMessageCommand({
			QueueUrl: sqsClient.queueUrl,
			MessageBody: JSON.stringify({
				images,
			}),
		});

		await sqsClient.send(command);
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
						thumbnail: `${CollectionId}/thumbnails/${ExternalImageId}.jpg`,
						original: `${CollectionId}/originals/${ExternalImageId}.jpg`,
						faces: faces.map(
							({ Face }) => `${CollectionId}/faces/${Face.FaceId}.jpg`,
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
