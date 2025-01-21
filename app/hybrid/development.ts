import { DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { randomUUID } from "crypto";
import sharp from "sharp";
import { RekognitionSingleton, S3Singleton } from "../providers";

const reko = RekognitionSingleton.getInstance();
const s3c = S3Singleton.getInstance();

async function extractFaceFromPicture(Key: string) {
  const command = new GetObjectCommand({
    Key,
    Bucket: s3c.bucketName,
  });

  const { Body } = await s3c.send(command);
  const image = await Body!.transformToByteArray();
  const metadata = await sharp(image).metadata();

  if (!metadata.width || !metadata.height) {
    return [];
  }

  const { FaceDetails } = await reko.send(
    new DetectFacesCommand({
      Image: {
        Bytes: image,
      },
    })
  );

  if (!FaceDetails?.length) {
    return [];
  }

  for (const { BoundingBox, Confidence, Quality } of FaceDetails) {
    if (!BoundingBox) {
      continue;
    }

    if (Confidence! < 90) {
      continue;
    }

    if (!Quality || !Quality.Brightness || !Quality.Sharpness) {
      continue;
    }

    if (Quality.Sharpness < 50 && Quality.Brightness < 90) {
      continue;
    }

    const { Height, Width, Left, Top } = BoundingBox;

    const params = {
      left: Math.round(Left! * metadata.width!),
      top: Math.round(Top! * metadata.height!),
      width: Math.round(Width! * metadata.width!),
      height: Math.round(Height! * metadata.height!),
    };

    const destination =
      "outputs/" +
      randomUUID() +
      `_Sharpness--${Quality?.Sharpness}_Brightness--${Quality?.Brightness}_Confidence-${Confidence}.jpg`;

    await sharp(image)
      .extract(params)
      /*
        .resize(Math.min(params.width, 1024), Math.min(params.height, 1024), {
          background: {
            r: 255,
            g: 255,
            b: 255,
            alpha: 1,
          },
          fit: "cover",
        })
      */
      .toFormat("jpeg")
      .toFile(destination);
  }
}

(async () => {
  {
    await extractFaceFromPicture(
      "uploads/incoming/3fa85f64-5717-4562-b3fc-2c963f66afa6/7.jpg"
    );
  }
})();
