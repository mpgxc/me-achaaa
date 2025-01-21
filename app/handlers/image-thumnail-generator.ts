import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { ListFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SQSBatchResponse, SQSEvent } from "aws-lambda";
import sharp from "sharp";
import {
  DynamoSingleton,
  RekognitionSingleton,
  S3Singleton,
} from "../providers";

export type DynamoFaceRecord = {
  PK: string;
  SK: string;
  CollectionId: string;
  Confidence: number;
  CreatedAt: string;
  ExternalImageId: string;
  FaceId: string;
  ImageId: string;
};

const s3Client = S3Singleton.getInstance();
const rekognitionClient = RekognitionSingleton.getInstance();
const dynamoDbClient = DynamoSingleton.getInstance();

const getImageFromBucket = async (Key: string): Promise<Uint8Array> => {
  const command = new GetObjectCommand({
    Key,
    Bucket: s3Client.bucketName,
  });

  const { Body } = await s3Client.send(command);

  return Body!.transformToByteArray();
};

const generateThumbnail = async (image: Uint8Array): Promise<Uint8Array> => {
  const thumbnail = await sharp(image)
    .resize({ width: 256, height: 256, fit: "inside" })
    .toBuffer();

  return thumbnail;
};

const generateThumbnailWithWaterMark = async (
  image: Uint8Array
): Promise<Uint8Array> => {
  const watermarkPath = __dirname + "/watermark.png";
  const thumbnail = await sharp(image)
    .resize({ width: 256, height: 256, fit: "inside" })
    .composite([
      {
        input: watermarkPath,
        gravity: "southeast",
      },
    ])
    .toBuffer();

  return thumbnail;
};

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

const extractFacePicture = async (key: string) => {
  try {
    const image = await getImageFromBucket(key);

    if (!image) {
      console.error("Failed to retrieve image from S3.");

      return [];
    }

    const metadata = await sharp(image).metadata();

    if (!metadata.width || !metadata.height) {
      console.warn("Image dimensions not available.");

      return [];
    }

    const { CollectionId } = extractExternalImageId(key);

    const command = new QueryCommand({
      TableName: dynamoDbClient.tableName,
      KeyConditionExpression: "#PK = :PK and begins_with(#SK, :SK)",
      ExpressionAttributeNames: {
        "#PK": "PK",
        "#SK": "SK",
      },
      ExpressionAttributeValues: marshall({
        ":PK": `ALBUM#${CollectionId}`,
        ":SK": `FACE#`,
      }),
    });

    const { Items } = await dynamoDbClient.send(command);

    if (!Items || !Items.length) {
      console.warn("No faces detected.");

      return [];
    }

    const AlbumFaces = Items.map((o) => unmarshall(o)) as DynamoFaceRecord[];

    const { Faces } = await rekognitionClient.send(
      new ListFacesCommand({
        CollectionId,
        FaceIds: AlbumFaces.map(({ FaceId }) => FaceId),
      })
    );

    if (!Faces || !Faces.length) {
      console.warn("No faces detected.");

      return [];
    }

    for (const { BoundingBox, FaceId } of Faces) {
      if (!BoundingBox) continue;

      const { Left, Top, Width, Height } = BoundingBox;

      if (!Left || !Top || !Width || !Height) continue;

      const left = Math.round(Left * metadata.width);
      const top = Math.round(Top * metadata.height);
      const width = Math.round(Width * metadata.width);
      const height = Math.round(Height * metadata.height);

      try {
        const croppedImage = await sharp(image)
          .extract({
            left,
            top,
            width: left + width,
            height: top + height,
          })
          .toBuffer();

        const command = new PutObjectCommand({
          Bucket: s3Client.bucketName,
          Key: `uploads/faces/${CollectionId}/${FaceId}.jpg`,
          Body: croppedImage,
          ContentType: "image/jpeg",
        });

        await s3Client.send(command);
      } catch (error) {
        console.error(
          `Error cropping face ${FaceId}: ${
            error instanceof Error ? error.message : JSON.stringify(error)
          }`
        );
      }
    }
  } catch (error) {
    console.error(
      `Error processing S3 event: ${JSON.stringify(error, null, 2)}`
    );

    return [];
  }
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const { body, messageId } = record;

    try {
      const { images } = JSON.parse(body) as { images: string[] };

      await processImagesHandler(images);
    } catch (error) {
      console.error(
        `Failed to process message ${messageId}: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`
      );

      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
};

const processImagesHandler = async (images: string[]) => {
  for (const image of images) {
    try {
      await extractFacePicture(image);
    } catch (error) {
      console.error(
        `Error processing image ${image}: ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`
      );

      throw error;
    }
  }
};
