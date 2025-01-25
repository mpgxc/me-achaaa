import {
	DetectFacesCommand,
	SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { RekognitionSingleton } from "../providers";

/***
 * Exemplo de busca de imagens por faces usando o Amazon Rekognition e Lambda.
 * Obs: Essa funcionalidade ficará no sistema principal NestJS.
 * Já que se trata de uma função REST que será frequentemente chamada é melhor
 * que ela fique no sistema principal para economizar chamadas ao Lambda.
 * Money que é good nóis num have. xD
 */

const rekognition = RekognitionSingleton.getInstance();

const verifyHowManyFacesInPicture = async (file: Buffer) => {
	const command = new DetectFacesCommand({
		Image: {
			Bytes: file,
		},
	});

	const output = await rekognition.send(command);

	return output.FaceDetails?.length || 0;
};

const searchFacesByImage = async (CollectionId: string, file: Buffer) => {
	const command = new SearchFacesByImageCommand({
		CollectionId,
		Image: {
			Bytes: file,
		},
		FaceMatchThreshold: 90,
	});

	return rekognition.send(command);
};

const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

export const handler = async (event: APIGatewayProxyEvent) => {
	try {
		const collectionId = event.headers["x-collection-id"];

		if (!collectionId) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "O cabeçalho x-collection-id é obrigatório.",
				}),
			};
		}

		if (!event.body) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "Corpo da requisição não encontrado.",
				}),
			};
		}

		const payloadSize = Buffer.byteLength(event.body, "utf8");

		if (payloadSize > MAX_PAYLOAD_SIZE) {
			return {
				statusCode: 413,
				body: JSON.stringify({
					message: "O tamanho do payload excede o limite de 5 MB.",
				}),
			};
		}

		const imageBase64 = event.body;

		if (!imageBase64 || !collectionId) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					principalId: "user",
					message:
						"Parâmetros inválidos: imageBase64 e collectionId são obrigatórios.",
				}),
			};
		}

		const file = Buffer.from(
			imageBase64.replace("data:image/jpeg;base64,", ""),
			"base64",
		);

		const facesCount = await verifyHowManyFacesInPicture(file);

		if (facesCount === 0) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "Nenhuma face encontrada na imagem.",
				}),
			};
		}

		if (facesCount > 1) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "Mais de uma face encontrada na imagem.",
				}),
			};
		}

		const searchFacesOutput = await searchFacesByImage(collectionId, file);

		const images =
			searchFacesOutput.FaceMatches?.map(
				(face) => face.Face?.ExternalImageId,
			) || [];

		return {
			statusCode: 200,
			body: JSON.stringify({
				images,
			}),
		};
	} catch (e) {
		const error = e as Error;

		return {
			statusCode: 500,
			body: JSON.stringify({
				message:
					error.message ||
					"Erro interno. Não foi possível processar a requisição.",
			}),
		};
	}
};
