import {
	type AttributeValue,
	DeleteItemCommand,
	GetItemCommand,
	PutItemCommand,
	QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { SearchFacesCommand } from "@aws-sdk/client-rekognition";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoSingleton, RekognitionSingleton } from "../../../providers";

// Limiar alto para agrupar faces da MESMA pessoa. Baixo demais funde pessoas
// diferentes num único cluster; 99 prioriza precisão sobre recall — é melhor
// dividir a mesma pessoa em duas do que juntar duas pessoas numa só.
const PERSON_MATCH_THRESHOLD = 99;
const MAX_FACES_PER_SEARCH = 100;

const coverKeyFor = (collectionId: string, faceId: string): string =>
	`uploads/faces/${collectionId}/${faceId}.jpg`;

export type FaceNeighbors = { faceId: string; neighbors: string[] };

/**
 * Agrupa faces em "pessoas" via union-find (disjoint-set). Cada face aponta
 * para as faces similares a ela (vizinhos); o fecho transitivo dessas ligações
 * é um cluster = uma pessoa. Se A~B e B~C, então A, B e C caem no mesmo grupo.
 *
 * Função pura (sem AWS) para ser testável isoladamente. A ordem de saída é
 * determinística: cada cluster é ordenado e os clusters são ordenados pelo
 * menor `faceId` — que também vira o `personId` (estável entre execuções desde
 * que a composição do cluster não mude).
 */
export const clusterFaces = (faces: FaceNeighbors[]): string[][] => {
	const parent = new Map<string, string>();

	const ensure = (id: string): void => {
		if (!parent.has(id)) {
			parent.set(id, id);
		}
	};

	const find = (id: string): string => {
		let root = id;

		while (parent.get(root) !== root) {
			root = parent.get(root) as string;
		}

		// Compressão de caminho: aponta todos os nós do caminho direto pra raiz.
		let cursor = id;

		while (parent.get(cursor) !== root) {
			const next = parent.get(cursor) as string;
			parent.set(cursor, root);
			cursor = next;
		}

		return root;
	};

	const union = (a: string, b: string): void => {
		const rootA = find(a);
		const rootB = find(b);

		if (rootA !== rootB) {
			parent.set(rootA, rootB);
		}
	};

	for (const { faceId, neighbors } of faces) {
		ensure(faceId);

		for (const neighbor of neighbors) {
			ensure(neighbor);
		}
	}

	for (const { faceId, neighbors } of faces) {
		for (const neighbor of neighbors) {
			union(faceId, neighbor);
		}
	}

	const groups = new Map<string, string[]>();

	for (const id of parent.keys()) {
		const root = find(id);
		const group = groups.get(root) ?? [];

		group.push(id);
		groups.set(root, group);
	}

	return [...groups.values()]
		.map((group) => [...group].sort())
		.sort((a, b) => a[0].localeCompare(b[0]));
};

type FaceRow = { FaceId: string; ExternalImageId?: string };

export type PersonSummary = {
	personId: string;
	coverFaceId: string;
	coverKey: string;
	faceCount: number;
	photoCount: number;
};

export type PersonPhotos = {
	personId: string;
	images: string[];
};

/**
 * Materializa e serve "pessoas" de um álbum. O caminho de LEITURA
 * (`listPeople` / `getPersonPhotos`) é barato e cacheável — lê o que já foi
 * gravado, sem tocar no Rekognition — e por isso pode ser servido por CDN.
 * O caminho de CONSTRUÇÃO (`rebuild`) é caro (uma chamada `SearchFaces` por
 * face) e roda sob demanda / offline; ver `people.routes.ts`.
 *
 * Registro no single-table: `PK=ALBUM#{collectionId}`, `SK=PERSON#{personId}`.
 */
export class PersonClusteringService {
	constructor(
		private dynamo = DynamoSingleton.getInstance(),
		private rekognition = RekognitionSingleton.getInstance(),
	) {}

	// --- leitura barata (cacheável / CDN) -----------------------------------

	async listPeople(collectionId: string): Promise<PersonSummary[]> {
		const people: PersonSummary[] = [];
		let exclusiveStartKey: Record<string, AttributeValue> | undefined;

		do {
			const { Items, LastEvaluatedKey } = await this.dynamo.send(
				new QueryCommand({
					TableName: this.dynamo.tableName,
					KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
					ExpressionAttributeValues: marshall({
						":pk": `ALBUM#${collectionId}`,
						":sk": "PERSON#",
					}),
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);

			for (const item of Items ?? []) {
				const record = unmarshall(item) as {
					PersonId: string;
					CoverFaceId: string;
					CoverKey: string;
					FaceCount: number;
					PhotoCount: number;
				};

				people.push({
					personId: record.PersonId,
					coverFaceId: record.CoverFaceId,
					coverKey: record.CoverKey,
					faceCount: record.FaceCount,
					photoCount: record.PhotoCount,
				});
			}

			exclusiveStartKey = LastEvaluatedKey;
		} while (exclusiveStartKey);

		return people;
	}

	async getPersonPhotos(
		collectionId: string,
		personId: string,
	): Promise<PersonPhotos | null> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: `PERSON#${personId}`,
				}),
			}),
		);

		if (!Item) {
			return null;
		}

		const record = unmarshall(Item) as { PersonId: string; Images?: string[] };

		return { personId: record.PersonId, images: record.Images ?? [] };
	}

	// --- construção cara (offline / sob demanda) ----------------------------

	/**
	 * Reconstrói os clusters de pessoas do álbum: busca os vizinhos de cada face
	 * no Rekognition, agrupa com union-find e regrava os registros `PERSON#`
	 * (limpando os antigos antes). Retorna um resumo `{ people, faces }`.
	 */
	async rebuild(
		collectionId: string,
	): Promise<{ people: number; faces: number }> {
		const faces = await this.listFaceRows(collectionId);
		const imageOf = new Map(
			faces.map((face) => [face.FaceId, face.ExternalImageId] as const),
		);

		const neighbors: FaceNeighbors[] = [];

		for (const { FaceId } of faces) {
			neighbors.push({
				faceId: FaceId,
				neighbors: await this.searchNeighbors(collectionId, FaceId),
			});
		}

		const clusters = clusterFaces(neighbors);

		// Limpa clusters anteriores para não deixar "pessoas" órfãs de um
		// rebuild passado (ex.: faces removidas por LGPD).
		await this.clearPeople(collectionId);

		for (const cluster of clusters) {
			const personId = cluster[0];
			const images = [
				...new Set(
					cluster
						.map((faceId) => imageOf.get(faceId))
						.filter((id): id is string => Boolean(id)),
				),
			].sort();

			await this.dynamo.send(
				new PutItemCommand({
					TableName: this.dynamo.tableName,
					Item: marshall({
						PK: `ALBUM#${collectionId}`,
						SK: `PERSON#${personId}`,
						PersonId: personId,
						CoverFaceId: personId,
						CoverKey: coverKeyFor(collectionId, personId),
						FaceIds: cluster,
						Images: images,
						FaceCount: cluster.length,
						PhotoCount: images.length,
						UpdatedAt: new Date().toISOString(),
					}),
				}),
			);
		}

		return { people: clusters.length, faces: faces.length };
	}

	private async searchNeighbors(
		collectionId: string,
		faceId: string,
	): Promise<string[]> {
		const { FaceMatches } = await this.rekognition.send(
			new SearchFacesCommand({
				CollectionId: collectionId,
				FaceId: faceId,
				FaceMatchThreshold: PERSON_MATCH_THRESHOLD,
				MaxFaces: MAX_FACES_PER_SEARCH,
			}),
		);

		return (FaceMatches ?? [])
			.map((match) => match.Face?.FaceId)
			.filter((id): id is string => Boolean(id));
	}

	private async listFaceRows(collectionId: string): Promise<FaceRow[]> {
		const rows: FaceRow[] = [];
		let exclusiveStartKey: Record<string, AttributeValue> | undefined;

		do {
			const { Items, LastEvaluatedKey } = await this.dynamo.send(
				new QueryCommand({
					TableName: this.dynamo.tableName,
					KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
					ExpressionAttributeValues: marshall({
						":pk": `ALBUM#${collectionId}`,
						":sk": "FACE#",
					}),
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);

			for (const item of Items ?? []) {
				const record = unmarshall(item) as FaceRow;

				rows.push({
					FaceId: record.FaceId,
					ExternalImageId: record.ExternalImageId,
				});
			}

			exclusiveStartKey = LastEvaluatedKey;
		} while (exclusiveStartKey);

		return rows;
	}

	private async clearPeople(collectionId: string): Promise<void> {
		const existing = await this.listPeople(collectionId);

		await Promise.all(
			existing.map((person) =>
				this.dynamo.send(
					new DeleteItemCommand({
						TableName: this.dynamo.tableName,
						Key: marshall({
							PK: `ALBUM#${collectionId}`,
							SK: `PERSON#${person.personId}`,
						}),
					}),
				),
			),
		);
	}
}
