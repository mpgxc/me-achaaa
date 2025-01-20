import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import {
  Face,
  FaceRecord,
  IndexFacesCommand,
} from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { marshall } from "@aws-sdk/util-dynamodb";
import { S3Event, S3EventRecord, SQSEvent } from "aws-lambda";
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

const rekognitionEventHandler = async (s3: S3EventRecord["s3"]) => {
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
      throw new Error(`No faces were indexed for image <${s3.object.key}>.`);
    }

    console.info(
      `S3 object <${s3.object.key}> indexed successfully in collection <${CollectionId}>`
    );
    return output.FaceRecords;
  } catch (error) {
    console.error(
      `Error processing S3 event: ${JSON.stringify(error, null, 2)}`
    );

    throw error;
  }
};

const cropFacesEventHandler = async (
  s3: S3EventRecord["s3"],
  faces: FaceRecord[]
) => {
  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({
        Bucket: s3.bucket.name,
        Key: s3.object.key,
      })
    );

    const image = await Body!.transformToByteArray();
    const metadata = await sharp(image).metadata();

    if (!metadata.width || !metadata.height) {
      console.warn("Image dimensions not available.");

      return;
    }

    const { CollectionId } = extractExternalImageId(s3.object.key);

    for (const { Face } of faces) {
      const { FaceId, BoundingBox } = Face!;
      if (!BoundingBox || !FaceId) continue;

      const left = Math.round(BoundingBox.Left! * metadata.width);
      const top = Math.round(BoundingBox.Top! * metadata.height);
      const width = Math.round(BoundingBox.Width! * metadata.width);
      const height = Math.round(BoundingBox.Height! * metadata.height);

      const croppedImage = await sharp(image)
        .extract({
          left,
          top,
          width,
          height,
        })
        .toBuffer();

      const command = new PutObjectCommand({
        Bucket: s3.bucket.name,
        Key: `uploads/${CollectionId}/faces/${FaceId}.jpg`,
        Body: croppedImage,
        ContentType: "image/jpeg",
      });

      await s3Client.send(command);
    }
  } catch (error) {
    console.error(
      `Error processing S3 event: ${JSON.stringify(error, null, 2)}`
    );

    throw error;
  }
};

export const handler = async ({ Records }: SQSEvent): Promise<void> => {
  const images: Array<{
    s3Key: string;
    faces: Face[];
  }> = [];

  for (const { body } of Records) {
    try {
      const { Records } = JSON.parse(body) as S3Event;

      const [{ s3 }] = Records;

      const faces = await rekognitionEventHandler(s3);

      if (!faces.length) {
        console.warn(`No faces found for S3 object <${s3.object.key}>.`);

        continue;
      }

      await cropFacesEventHandler(s3, faces).catch((error) => {
        console.error(
          `Error cropping faces for S3 object <${s3.object.key}>: ${
            error instanceof Error ? error.message : JSON.stringify(error)
          }`
        );
      });

      images.push({
        s3Key: decodeURIComponent(s3.object.key),
        faces: faces.map(({ Face }) => Face!),
      });
    } catch (error) {
      console.error(
        `Error processing S3 event: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`
      );
    } finally {
      await registerImageMetadata(images).catch((error) => {
        console.error(
          `Error registering image metadata: ${
            error instanceof Error ? error.message : JSON.stringify(error)
          }`
        );
      });
    }
  }
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
  Faces: { CollectionId: string; faces: Face[] }[]
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
