import { randomUUID } from "node:crypto";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall } from "@aws-sdk/util-dynamodb";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyResultV2,
} from "aws-lambda";
import { DynamoSingleton, S3Singleton } from "../providers";

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 300; // 5 minutes

const dynamodb = DynamoSingleton.getInstance();
const s3Client = S3Singleton.getInstance();

export const handler = async (
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
	try {
		const externalClientAlbumId = event.pathParameters?.externalClientAlbumId;

		if (!externalClientAlbumId) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "O parâmetro externalClientAlbumId é obrigatório.",
				}),
			};
		}

		const { Item } = await dynamodb.send(
			new GetItemCommand({
				TableName: dynamodb.tableName,
				Key: marshall({
					PK: `ALBUM#${externalClientAlbumId}`,
					SK: "METADATA",
				}),
			}),
		);

		if (!Item) {
			return {
				statusCode: 404,
				body: JSON.stringify({ message: "Álbum não encontrado." }),
			};
		}

		const imageId = randomUUID();
		const key = `uploads/incoming/${externalClientAlbumId}/${imageId}.jpg`;

		const command = new PutObjectCommand({
			Bucket: s3Client.bucketName,
			Key: key,
			ContentType: "image/jpeg",
		});

		const uploadUrl = await getSignedUrl(s3Client, command, {
			expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
		});

		return {
			statusCode: 200,
			body: JSON.stringify({ uploadUrl, key }),
		};
	} catch (e) {
		const error = e as Error;

		return {
			statusCode: 500,
			body: JSON.stringify({
				message:
					error.message ||
					"Erro interno. Não foi possível gerar a URL de upload.",
			}),
		};
	}
};
