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

    /**
     * Extract the external image id from the S3 object key.
     */
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
      throw new Error(
        `Indexer Handler: No faces were indexed for image <${s3.object.key}>.`
      );
    }

    console.info(
      `Indexer Handler: S3 object <${s3.object.key}> indexed successfully in collection <${CollectionId}>`
    );

    return output.FaceRecords;
  } catch (error) {
    console.error(
      `RekognitionEventHandler: Error processing S3 event: ${JSON.stringify(
        error,
        null,
        2
      )}`
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
      console.warn("Não foi possível obter as dimensões da imagem.");

      return;
    }

    const { CollectionId } = extractExternalImageId(s3.object.key);

    for (const { Face } of faces) {
      const { FaceId, BoundingBox } = Face!;

      if (!BoundingBox || !FaceId) {
        continue;
      }

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
      `CropFacesEventHandler: Error processing S3 event: ${JSON.stringify(
        error,
        null,
        2
      )}`
    );
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
        console.warn(
          `Handler: No faces found for S3 object <${s3.object.key}>.`
        );
        continue;
      }

      await cropFacesEventHandler(s3, faces).catch((error) => {
        console.error(
          `Handler: Error processing S3 event: ${JSON.stringify(
            error,
            null,
            2
          )}`
        );
      });

      images.push({
        s3Key: decodeURIComponent(s3.object.key),
        faces: faces.map(({ Face }) => Face!),
      });
    } catch (e) {
      console.error(
        `Root: Error processing S3 event: ${
          e instanceof Error ? e.message : JSON.stringify(e)
        }`
      );
    } finally {
      await registerImageMetadata(images);
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
  Faces: {
    CollectionId: string;
    faces: Face[];
  }[]
) => {
  const RequestItems = [];

  for (const { CollectionId, faces } of Faces) {
    for (const { FaceId, ImageId, ExternalImageId, Confidence } of faces) {
      RequestItems.push({
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
      });
    }
  }

  const command = new BatchWriteItemCommand({
    RequestItems: {
      [dynamodb.tableName]: RequestItems,
    },
  });

  await dynamodb.send(command);
};
