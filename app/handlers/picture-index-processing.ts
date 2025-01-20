import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import {
  Face,
  FaceRecord,
  IndexFacesCommand,
} from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { marshall } from "@aws-sdk/util-dynamodb";
import { S3Event, S3EventRecord, SQSBatchResponse, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import {
  DynamoSingleton,
  RekognitionSingleton,
  S3Singleton,
} from "../providers.js";

const rekognition = RekognitionSingleton.getInstance();
const s3Client = S3Singleton.getInstance();
const dynamodb = DynamoSingleton.getInstance();

const extractExternalImageId = (key: string) => {
  const [, CollectionId, ExternalImageId] = key.split("/");
  return {
    CollectionId,
    ExternalImageId,
  };
};

const rekognitionEventHandler = async (
  s3: S3EventRecord["s3"]
): Promise<FaceRecord[]> => {
  try {
    console.info(
      `Processing S3 object <${s3.object.key}> from bucket <${s3.bucket.name}>`
    );

    const { ExternalImageId, CollectionId } = extractExternalImageId(
      s3.object.key
    );

    const command = new IndexFacesCommand({
      CollectionId,
      Image: {
        S3Object: {
          Bucket: s3.bucket.name,
          Name: s3.object.key,
        },
      },
      MaxFaces: 3,
      QualityFilter: "HIGH",
      ExternalImageId,
      DetectionAttributes: ["ALL"],
    });

    const output = await rekognition.send(command);

    if (!output.FaceRecords || output.FaceRecords.length === 0) {
      console.warn(`No faces were indexed for image <${s3.object.key}>.`);
    }

    console.info(
      `S3 object <${s3.object.key}> indexed successfully in collection <${CollectionId}>`
    );

    return output?.FaceRecords || [];
  } catch (error) {
    console.error(
      `Error processing S3 event: ${JSON.stringify(error, null, 2)}`
    );

    return [];
  }
};

const cropFacesEventHandler = async (
  s3: S3EventRecord["s3"],
  faces: FaceRecord[]
): Promise<string[]> => {
  try {
    const croppeds: string[] = [];

    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: s3.bucket.name,
        Key: s3.object.key,
      })
    );

    const image = await Body!.transformToByteArray();

    if (!image) {
      console.error("Failed to retrieve image from S3.");

      return [];
    }

    const metadata = await sharp(image).metadata();

    if (!metadata.width || !metadata.height) {
      console.warn("Image dimensions not available.");

      return [];
    }

    const { CollectionId } = extractExternalImageId(s3.object.key);

    for (const { Face } of faces) {
      if (!Face || !Face.BoundingBox || !Face.FaceId) continue;

      const { FaceId, BoundingBox } = Face;
      const { Left, Top, Width, Height } = BoundingBox;

      const left = Math.round(Left! * metadata.width);
      const top = Math.round(Top! * metadata.height);
      const width = Math.round(Width! * metadata.width);
      const height = Math.round(Height! * metadata.height);

      try {
        const croppedImage = await sharp(image)
          .extract({
            left,
            top,
            width,
            height,
          })
          .toBuffer();

        {
          const command = new PutObjectCommand({
            Bucket: s3.bucket.name,
            Key: `uploads/${CollectionId}/faces/${FaceId}.jpg`,
            Body: croppedImage,
            ContentType: "image/jpeg",
          });

          await s3Client.send(command);
        }

        croppeds.push(FaceId);
      } catch (error) {
        console.error(
          `Error cropping face ${FaceId}: ${
            error instanceof Error ? error.message : JSON.stringify(error)
          }`
        );
      }
    }

    return croppeds;
  } catch (error) {
    console.error(
      `Error processing S3 event: ${JSON.stringify(error, null, 2)}`
    );

    return [];
  }
};

export const handler = async ({
  Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
  const processedImages: Array<{
    s3Key: string;
    faces: Face[];
  }> = [];

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const { body, messageId } of Records) {
    const { Records } = JSON.parse(body) as S3Event;
    const [{ s3 }] = Records;

    try {
      const faces = await rekognitionEventHandler(s3);

      if (!faces.length) {
        console.warn(`No faces found for S3 object <${s3.object.key}>.`);

        continue;
      }

      const croppeds = (await cropFacesEventHandler(s3, faces)) || [];

      processedImages.push({
        s3Key: decodeURIComponent(s3.object.key),
        faces: faces
          .filter(({ Face }) => croppeds.includes(Face?.FaceId!))
          .map(({ Face }) => Face!),
      });
    } catch (error) {
      console.error(
        `Error processing S3 event: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`
      );

      batchItemFailures.push({
        itemIdentifier: messageId,
      });

      continue;
    }
  }

  await registerImageMetadata(processedImages).catch((error) => {
    console.error(
      `Error registering image metadata: ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`
    );
  });

  return { batchItemFailures };
};

const registerImageMetadata = async (
  images: Array<{
    s3Key: string;
    faces: Face[];
  }>
) => {
  const allfaces = [] as {
    CollectionId: string;
    faces: Face[];
  }[];

  const command = new BatchWriteItemCommand({
    RequestItems: {
      [dynamodb.tableName]: images.map(({ s3Key, faces }) => {
        const { CollectionId, ExternalImageId } = extractExternalImageId(s3Key);

        allfaces.push({ CollectionId, faces });

        return {
          PutRequest: {
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
      }),
    },
  });

  await dynamodb.send(command);

  await registerFacesImageMetadata(allfaces);
};

const registerFacesImageMetadata = async (
  Faces: {
    CollectionId: string;
    faces: Face[];
  }[]
) => {
  const Items = Faces.flatMap(({ CollectionId, faces }) =>
    faces.map(({ FaceId, ImageId, ExternalImageId, Confidence }) => ({
      PutRequest: {
        Item: marshall({
          PK: `ALBUM#${CollectionId}`,
          SK: `FACE#${FaceId}`,
          CollectionId,
          ExternalImageId,
          FaceId,
          ImageId,
          Confidence,
          CreatedAt: new Date().toISOString(),
        }),
      },
    }))
  );

  const command = new BatchWriteItemCommand({
    RequestItems: {
      [dynamodb.tableName]: Items,
    },
  });

  await dynamodb.send(command);
};
