import { RekognitionClient } from "@aws-sdk/client-rekognition";

export class RekognitionSingleton {
  private static instance: RekognitionClient;

  private constructor() {
    throw new Error("Cannot instantiate a singleton class");
  }

  public static getInstance(): RekognitionClient {
    if (!RekognitionSingleton.instance) {
      RekognitionSingleton.instance = new RekognitionClient({
        region: "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });
    }

    return RekognitionSingleton.instance;
  }
}
