import {
  DetectFacesCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import sharp from "sharp";

const rekognitionClient = new RekognitionClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const s3Client = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const S3_BUCKET = "infra-face-rekognition-sls-dev-bucket";

export const handler = async () => {
  try {
    await cropAndSaveFaces("uploads/WIN_20250113_15_37_31_Pro.jpg");
  } catch (e) {
    const error = e as Error;

    console.error("Erro no processamento:", error.message);
  }
};

const cropAndSaveFaces = async (fileKey: string) => {
  const { Body } = await s3Client.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: fileKey,
    })
  );

  if (!Body) {
    console.warn(`Nenhum objeto encontrado no bucket para a chave: ${fileKey}`);

    return;
  }

  const image = await Body.transformToByteArray();
  const metadata = await sharp(image).metadata();

  if (!metadata.width || !metadata.height) {
    console.warn("Não foi possível obter as dimensões da imagem.");

    return;
  }

  const command = new DetectFacesCommand({
    Image: {
      Bytes: image,
    },
    Attributes: ["ALL"],
  });

  const output = await rekognitionClient.send(command);

  for (const { BoundingBox } of output.FaceDetails || []) {
    if (!BoundingBox) {
      continue;
    }

    const left = Math.floor(BoundingBox.Left! * metadata.width);
    const top = Math.floor(BoundingBox.Top! * metadata.height);
    const width = Math.floor(BoundingBox.Width! * metadata.width);
    const height = Math.floor(BoundingBox.Height! * metadata.height);

    const croppedImage = await sharp(image)
      .extract({
        top,
        left,
        width,
        height,
      })
      .toBuffer();

    const imageKey = `croppeds/${randomUUID()}.jpg`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: imageKey,
      Body: croppedImage,
      ContentType: "image/jpeg",
    });

    await s3Client.send(command);
  }
};

handler()
  .then(() => console.log("Processamento finalizado."))
  .catch(console.error);
