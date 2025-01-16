import {
  IndexFacesCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import { S3Event, SQSEvent, SQSRecord } from "aws-lambda";

const rekognitionClient = new RekognitionClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (e) {
      const error = e as Error;

      console.error(`Error processing record: ${error.message}`);
    }
  }
};

export const processRecord = async (record: SQSRecord) => {
  try {
    const messageBody = JSON.parse(record.body) as S3Event;

    const [{ s3 }] = messageBody.Records;

    console.info(
      `Processing S3 object <${s3.object.key}> from bucket <${s3.bucket.name}>`
    );

    const imagename = s3.object.key.split("/").pop();

    const command = new IndexFacesCommand({
      CollectionId: process.env.REKOGNITION_COLLECTION,
      Image: {
        S3Object: {
          Bucket: s3.bucket.name,
          Name: s3.object.key,
        },
      },
      ExternalImageId: imagename,
      DetectionAttributes: ["ALL"],
    });

    const output = await rekognitionClient.send(command);

    if (!output.FaceRecords || output.FaceRecords.length === 0) {
      throw new Error(
        `Indexer Handler: No faces were indexed for image <${s3.object.key}>.`
      );
    }

    console.info(
      `Indexer Handler: S3 object <${s3.object.key}> indexed successfully in collection>`
    );
  } catch (error) {
    console.error(`Error processing S3 event: ${error}`);

    throw error;
  }
};
