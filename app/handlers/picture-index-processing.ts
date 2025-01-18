import { FaceRecord, IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3Event, S3EventRecord, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import { RekognitionSingleton, S3Singleton } from "../providers.js";

const rekognition = RekognitionSingleton.getInstance();
const s3Client = S3Singleton.getInstance();

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

    if (!Body) {
      throw new Error("Failed to retrieve image body from S3.");
    }
    const image = await Body.transformToByteArray();
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

      const border = 80;

      const left = Math.floor(BoundingBox.Left! * (metadata.width + border));
      const top = Math.floor(BoundingBox.Top! * (metadata.height + border));
      const width = Math.floor(BoundingBox.Width! * (metadata.width + border));
      const height = Math.floor(
        BoundingBox.Height! * (metadata.height + border)
      );

      const croppedImage = await sharp(image)
        .extract({
          top,
          left,
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

    throw error;
  }
};

export const handler = async ({ Records }: SQSEvent): Promise<void> => {
  for (const { body } of Records) {
    try {
      const { Records } = JSON.parse(body) as S3Event;

      const [{ s3 }] = Records;

      const faces = await rekognitionEventHandler(s3);

      if (!faces.length) {
        return;
      }

      await cropFacesEventHandler(s3, faces);
    } catch (e) {
      const error = e as Error;

      console.error(
        `Root: Error processing S3 event: ${
          error.message || JSON.stringify(error)
        }`
      );

      continue;
    }
  }
};
