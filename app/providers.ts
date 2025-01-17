import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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

export class DynamoSingleton extends DynamoDBClient {
  private static instance: DynamoSingleton;

  private constructor() {
    super({
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  public static getInstance(): DynamoSingleton {
    if (!DynamoSingleton.instance) {
      DynamoSingleton.instance = new DynamoSingleton();
    }

    return DynamoSingleton.instance;
  }

  /**
   * Depois pegar via env
   */
  get tableName() {
    return "infra-face-rekognition-sls-dev-rekognition-bucket-assets-controll";
  }
}
