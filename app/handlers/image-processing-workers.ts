import { FaceRecord } from "@aws-sdk/client-rekognition";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { S3EventRecord } from "aws-lambda";
import sharp from "sharp";
import { S3Singleton } from "../providers";

const s3Client = S3Singleton.getInstance();

const getImageFromBucket = async (
  s3: S3EventRecord["s3"]
): Promise<Uint8Array> => {
  const { Body } = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3.bucket.name,
      Key: s3.object.key,
    })
  );

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

const cropFacesEventHandler = async (
  s3: S3EventRecord["s3"],
  faces: FaceRecord[]
): Promise<string[]> => {
  try {
    const croppeds: string[] = [];

    const image = await getImageFromBucket(s3);

    if (!image) {
      console.error("Failed to retrieve image from S3.");

      return [];
    }

    /**
     * @todo Remover daqui e adicionar em um novo handler
     */
    {
      const { CollectionId, ExternalImageId } = extractExternalImageId(
        s3.object.key
      );
      const thumbnailPath = `uploads/${CollectionId}/thumbnails/${ExternalImageId}.jpg`;
      const watermarkThumbnailPath = `uploads/${CollectionId}/thumbnails/${ExternalImageId}-watermark.jpg`;

      await generateThumbnail(image).then(async (thumbnail) => {
        const command = new PutObjectCommand({
          Bucket: s3.bucket.name,
          Key: thumbnailPath,
          Body: thumbnail,
          ContentType: "image/jpeg",
        });

        try {
          await s3Client.send(command);
          console.info(`Thumbnail uploaded to ${thumbnailPath}`);
        } catch (error) {
          console.error(
            `Error uploading thumbnail to ${thumbnailPath}: ${error}`
          );
        }
      });

      await generateThumbnailWithWaterMark(image).then(async (thumbnail) => {
        const command = new PutObjectCommand({
          Bucket: s3.bucket.name,
          Key: watermarkThumbnailPath,
          Body: thumbnail,
          ContentType: "image/jpeg",
        });

        try {
          await s3Client.send(command);
          console.info(
            `Watermark thumbnail uploaded to ${watermarkThumbnailPath}`
          );
        } catch (error) {
          console.error(
            `Error uploading watermark thumbnail to ${watermarkThumbnailPath}: ${error}`
          );
        }
      });
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
