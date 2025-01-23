import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { APIGatewayEvent } from "aws-lambda";
import { S3Singleton } from "../providers";

const s3Client = S3Singleton.getInstance();

export const handler = async ({ queryStringParameters }: APIGatewayEvent) => {
	const limit = queryStringParameters?.limit
		? +queryStringParameters.limit
		: 20;

	const { Contents } = await s3Client.send(
		new ListObjectsV2Command({
			Bucket: s3Client.bucketName,
			MaxKeys: limit,
			Prefix: `uploads/${queryStringParameters?.collectionId}/`,
		}),
	);

	const cloudfront = "";

	const images = Contents?.map(({ Key }) => `${cloudfront}${Key}`) || [];

	return {
		statusCode: 200,
		body: JSON.stringify({ images }),
	};
};
