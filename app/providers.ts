import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

const awsClientConfig = {
	region:
		process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
};

export class RekognitionSingleton {
	private static instance: RekognitionClient;

	private constructor() {
		throw new Error("Cannot instantiate a singleton class");
	}

	public static getInstance(): RekognitionClient {
		if (!RekognitionSingleton.instance) {
			RekognitionSingleton.instance = new RekognitionClient(awsClientConfig);
		}

		return RekognitionSingleton.instance;
	}
}

export class DynamoSingleton extends DynamoDBClient {
	private static instance: DynamoSingleton;

	private constructor() {
		super(awsClientConfig);
	}

	public static getInstance(): DynamoSingleton {
		if (!DynamoSingleton.instance) {
			DynamoSingleton.instance = new DynamoSingleton();
		}

		return DynamoSingleton.instance;
	}

	get tableName(): string {
		const name = process.env.DYNAMO_TABLE_NAME;

		if (!name) {
			throw new Error("DYNAMO_TABLE_NAME environment variable is not set");
		}

		return name;
	}
}

export class S3Singleton extends S3Client {
	private static instance: S3Singleton;

	private constructor() {
		super(awsClientConfig);
	}

	public static getInstance(): S3Singleton {
		if (!S3Singleton.instance) {
			S3Singleton.instance = new S3Singleton();
		}

		return S3Singleton.instance;
	}

	get bucketName(): string {
		const name = process.env.S3_BUCKET_NAME;

		if (!name) {
			throw new Error("S3_BUCKET_NAME environment variable is not set");
		}

		return name;
	}
}

export class SqsSingleton extends SQSClient {
	private static instance: SqsSingleton;

	private constructor() {
		super(awsClientConfig);
	}

	public static getInstance(): SqsSingleton {
		if (!SqsSingleton.instance) {
			SqsSingleton.instance = new SqsSingleton();
		}

		return SqsSingleton.instance;
	}

	get queueUrl() {
		return {
			THUMBNAIL: process.env.IMAGE_PROCESSING_THUMBNAIL,
			FACE_EXTRACT: process.env.IMAGE_PROCESSING_FACE_EXTRACT,
		};
	}
}
