import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

const credentials = {
  region: "us-east-1",
  /*
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  */
};

export class RekognitionSingleton {
  private static instance: RekognitionClient;

  private constructor() {
    throw new Error("Cannot instantiate a singleton class");
  }

  public static getInstance(): RekognitionClient {
    if (!RekognitionSingleton.instance) {
      RekognitionSingleton.instance = new RekognitionClient(credentials);
    }

    return RekognitionSingleton.instance;
  }
}

export class DynamoSingleton extends DynamoDBClient {
  private static instance: DynamoSingleton;

  private constructor() {
    super(credentials);
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

export class S3Singleton extends S3Client {
  private static instance: S3Singleton;

  private constructor() {
    super(credentials);
  }

  public static getInstance(): S3Singleton {
    if (!S3Singleton.instance) {
      S3Singleton.instance = new S3Singleton();
    }

    return S3Singleton.instance;
  }

  get bucketName() {
    return "infra-face-rekognition-sls-dev-bucket";
  }
}

export class SqsSingleton extends SQSClient {
  private static instance: SqsSingleton;

  private constructor() {
    super(credentials);
  }

  public static getInstance(): SqsSingleton {
    if (!SqsSingleton.instance) {
      SqsSingleton.instance = new SqsSingleton();
    }

    return SqsSingleton.instance;
  }

  get queueUrl() {
    return process.env.IMAGE_PROCESSING_THUMBNAIL!;
  }
}
