import { FaceRecord, IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { S3Event, S3EventRecord, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import {
  RekognitionSingleton,
  S3Singleton,
  SqsSingleton,
} from "../providers.js";

const rekognition = RekognitionSingleton.getInstance();
const s3Client = S3Singleton.getInstance();
const sqsClient = SqsSingleton.getInstance();

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

      const left = Math.round(BoundingBox.Left! * metadata.width);
      const top = Math.round(BoundingBox.Top! * metadata.height);

      const right = Math.round(
        (BoundingBox.Left! + BoundingBox.Width!) * metadata.width
      );

      const bottom = Math.round(
        (BoundingBox.Top! + BoundingBox.Height!) * metadata.height
      );

      const croppedImage = await sharp(image)
        .extract({
          left,
          top,
          width: right - left,
          height: bottom - top,
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
    imageId: string;
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

      await publishMetadataOnQueue({
        s3Key: s3.object.key,
        images: faces,
        isFace: true,
      });

      images.push({
        s3Key: s3.object.key,
        imageId: faces[0].Face?.ImageId!,
      });

      await cropFacesEventHandler(s3, faces);
    } catch (e) {
      console.error(
        `Root: Error processing S3 event: ${
          e instanceof Error ? e.message : JSON.stringify(e)
        }`
      );
    } finally {
      await publishMetadataOnQueue({ images });

      console.log("Processing finished.");
    }
  }
};

const publishMetadataOnQueue = async ({
  s3Key,
  images,
  isFace = false,
}: {
  s3Key?: string;
  images:
    | FaceRecord[]
    | Array<{
        s3Key: string;
        imageId: string;
      }>;
  isFace?: boolean;
}) => {
  console.log("publishMetadataOnQueue", { s3Key, images, isFace });

  if (isFace) {
    const { CollectionId } = extractExternalImageId(s3Key!);

    const messages = chunkArray(images as FaceRecord[], 10);

    for (const message of messages) {
      const command = new SendMessageBatchCommand({
        QueueUrl: sqsClient.queueUrl,
        Entries: message.map(({ Face }) => {
          const { FaceId, ImageId } = Face!;

          return {
            Id: FaceId!,
            MessageGroupId: CollectionId,
            MessageBody: JSON.stringify({
              isFace,
              ImageId,
              CollectionId,
              FaceId,
            }),
          };
        }),
      });

      await sqsClient.send(command);
    }
  } else {
    const messages = chunkArray(
      images as Array<{
        s3Key: string;
        imageId: string;
      }>,
      10
    );

    for (const message of messages) {
      const command = new SendMessageBatchCommand({
        QueueUrl: sqsClient.queueUrl,
        Entries: message.map(({ s3Key, imageId }) => {
          const { CollectionId, ExternalImageId } =
            extractExternalImageId(s3Key);
          return {
            Id: imageId,
            MessageGroupId: CollectionId,
            MessageBody: JSON.stringify({
              isFace,
              ImageId: imageId,
              CollectionId,
              ExternalImageId,
            }),
          };
        }),
      });

      await sqsClient.send(command);
    }
  }
};

const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) {
    return [];
  }

  const chunks: T[][] = [];

  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }

  return chunks;
};
