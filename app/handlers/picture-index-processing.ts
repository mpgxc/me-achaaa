import {
  TransactWriteItem,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { Face, IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { marshall } from "@aws-sdk/util-dynamodb";
import { S3Event, S3EventRecord, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { DynamoSingleton, RekognitionSingleton } from "../providers.js";

const TRANSACTIONS_LIMIT_PER_BATCH = 50;

const rekognition = RekognitionSingleton.getInstance();
const dynamodb = DynamoSingleton.getInstance();

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

const splitBatches = (items: TransactWriteItem[], batchSize = 100) => {
  return items.reduce((batches, item, index) => {
    const batchIndex = Math.floor(index / batchSize);

    if (!batches[batchIndex]) {
      batches[batchIndex] = [];
    }

    batches[batchIndex].push(item);

    return batches;
  }, [] as TransactWriteItem[][]);
};

const rekognitionEventHandler = async ({
  bucket,
  object,
}: Pick<S3EventRecord["s3"], "bucket" | "object">): Promise<Face[]> => {
  try {
    const { ExternalImageId, CollectionId } = extractExternalImageId(
      object.key
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
        `Rekognition: No faces were indexed for image ${object.key}`
      );

      return [];
    }

    console.info(
      `Rekognition: ${FaceRecords?.length} faces indexed for image ${object.key}`
    );

    return FaceRecords.flatMap(({ Face }) => Face || []);
  } catch (error) {
    console.error(
      `Rekognition: Error processing S3 event: ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`
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
    faces: Face[];
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
        }`
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
      }`
    );
  });

  return { batchItemFailures };
};

const registerImageMetadata = async (
  images: Array<{ key: string; faces: Face[] }>
) => {
  const facesToStore = [] as Array<{
    CollectionId: string;
    faces: Face[];
  }>;

  const TransactItems = images.map(({ key, faces }) => {
    const { CollectionId, ExternalImageId } = extractExternalImageId(key);

    facesToStore.push({
      CollectionId,
      faces,
    });

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
              ({ FaceId }) => `${CollectionId}/faces/${FaceId!}.jpg`
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

  await registerFacesImageMetadata(facesToStore);
};

const registerFacesImageMetadata = async (
  images: Array<{
    CollectionId: string;
    faces: Face[];
  }>
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
        } as TransactWriteItem)
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
