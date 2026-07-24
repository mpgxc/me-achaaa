import { createHash } from "node:crypto";
import {
	type AttributeValue,
	DeleteItemCommand,
	GetItemCommand,
	PutItemCommand,
	QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoSingleton } from "../../../providers";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * Hash de conteúdo da imagem (SHA-256). A mesma selfie reenviada gera a mesma
 * chave — é o suficiente para servir refresh / nova tentativa / paginação sem
 * re-chamar o Rekognition. (Um hash perceptual pegaria também imagens quase
 * idênticas, mas exige decodificar a imagem; fica como evolução.)
 */
export const hashImage = (image: Buffer): string =>
	createHash("sha256").update(image).digest("hex");

/**
 * Cache de resultados de busca por imagem, no mesmo single-table (com TTL do
 * DynamoDB). Chave: `PK=SEARCHCACHE#{collectionId}`, `SK=HASH#{sha256}`.
 * Evita pagar Rekognition (`DetectFaces` + `SearchFacesByImage`) quando a
 * mesma busca acontece de novo no mesmo álbum.
 */
export class SearchCacheService {
	constructor(private dynamo = DynamoSingleton.getInstance()) {}

	async get(collectionId: string, hash: string): Promise<string[] | null> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `SEARCHCACHE#${collectionId}`,
					SK: `HASH#${hash}`,
				}),
			}),
		);

		if (!Item) {
			return null;
		}

		const record = unmarshall(Item) as {
			images?: string[];
			ExpiresAt?: number;
		};

		// Defensivo: o TTL do DynamoDB apaga eventualmente, mas pode atrasar.
		if (record.ExpiresAt && record.ExpiresAt * 1000 < Date.now()) {
			return null;
		}

		return record.images ?? null;
	}

	async put(
		collectionId: string,
		hash: string,
		images: string[],
		ttlSeconds = DEFAULT_TTL_SECONDS,
	): Promise<void> {
		const now = Date.now();

		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall({
					PK: `SEARCHCACHE#${collectionId}`,
					SK: `HASH#${hash}`,
					images,
					CreatedAt: new Date(now).toISOString(),
					ExpiresAt: Math.floor(now / 1000) + ttlSeconds,
				}),
			}),
		);
	}

	/**
	 * Descarta todo o cache de busca de uma coleção. Chamado quando o conjunto
	 * de faces do álbum muda (nova indexação ou remoção por LGPD) — senão uma
	 * busca cacheada continuaria devolvendo fotos de uma face já apagada, ou
	 * deixaria de fora fotos recém-indexadas, por até o TTL inteiro.
	 */
	async invalidate(collectionId: string): Promise<void> {
		let exclusiveStartKey: Record<string, AttributeValue> | undefined;

		do {
			const { Items, LastEvaluatedKey } = await this.dynamo.send(
				new QueryCommand({
					TableName: this.dynamo.tableName,
					KeyConditionExpression: "PK = :pk",
					ExpressionAttributeValues: marshall({
						":pk": `SEARCHCACHE#${collectionId}`,
					}),
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);

			await Promise.all(
				(Items ?? []).map((item) => {
					const { SK } = unmarshall(item) as { SK: string };

					return this.dynamo.send(
						new DeleteItemCommand({
							TableName: this.dynamo.tableName,
							Key: marshall({ PK: `SEARCHCACHE#${collectionId}`, SK }),
						}),
					);
				}),
			);

			exclusiveStartKey = LastEvaluatedKey;
		} while (exclusiveStartKey);
	}
}
