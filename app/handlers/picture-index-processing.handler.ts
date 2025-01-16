import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { S3Event, SQSEvent } from "aws-lambda";
import { RekognitionSingleton } from "../rekognition.js";

const client = RekognitionSingleton.getInstance();

const extractExternalImageId = (key: string) => key.split("/").pop();

const eventHandler = async (content: string) => {
  try {
    const { Records } = JSON.parse(content) as S3Event;

    const [{ s3 }] = Records;

    console.info(
      `Processing S3 object <${s3.object.key}> from bucket <${s3.bucket.name}>`
    );

    /**
     * Extract the external image id from the S3 object key.
     */
    const ExternalImageId = extractExternalImageId(s3.object.key);

    const command = new IndexFacesCommand({
      CollectionId: process.env.REKOGNITION_COLLECTION,
      Image: {
        S3Object: {
          Bucket: s3.bucket.name,
          Name: s3.object.key,
        },
      },
      ExternalImageId,
      DetectionAttributes: ["ALL"],
    });

    const output = await client.send(command);

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

export const handler = async ({ Records }: SQSEvent): Promise<void> => {
  for (const { body } of Records) {
    await eventHandler(body);
  }
};
