import { randomUUID } from "node:crypto";
import {
	type AttributeValue,
	DeleteItemCommand,
	GetItemCommand,
	PutItemCommand,
	QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { SearchFacesCommand } from "@aws-sdk/client-rekognition";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
	DynamoSingleton,
	RekognitionSingleton,
	SqsSingleton,
} from "../../../providers";

// Limiar alto para agrupar faces da MESMA pessoa. Baixo demais funde pessoas
// diferentes num único cluster; 99 prioriza precisão sobre recall — é melhor
// dividir a mesma pessoa em duas do que juntar duas pessoas numa só.
const PERSON_MATCH_THRESHOLD = 99;
const MAX_FACES_PER_SEARCH = 100;

// Uma linha de status por álbum, atualizada ao longo do rebuild assíncrono.
const REBUILD_STATUS_SK = "PERSONREBUILD#STATUS";
// Marcador de "rebuild pendente" (debounce do rebuild automático).
const REBUILD_PENDING_SK = "PERSONREBUILD#PENDING";
// Janela de silêncio do debounce: coalesce um lote de uploads num rebuild só.
const AUTO_REBUILD_QUIET_SECONDS = 120;

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

// Referência face→imagem guardada em cada PERSON#, para podar uma face do
// cluster (LGPD) sem precisar reconstruir tudo pelo Rekognition.
type PersonFaceRef = { faceId: string; imageId?: string };

type PersonRecord = {
	PersonId: string;
	FaceIds?: string[];
	Faces?: PersonFaceRef[];
	Images?: string[];
};

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

export type RebuildStatus = {
	status: "queued" | "running" | "done" | "failed";
	queuedAt?: string;
	startedAt?: string;
	finishedAt?: string;
	people?: number;
	faces?: number;
	error?: string;
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
		private sqs = SqsSingleton.getInstance(),
	) {}

	// --- enfileiramento assíncrono (o rebuild é caro demais p/ o request) ----

	/**
	 * Enfileira um rebuild para rodar fora do request. O rebuild é O(N)
	 * `SearchFaces` (um por face) e estoura o limite de ~29s do API Gateway em
	 * álbuns grandes — então a rota só publica na fila e devolve 202; o worker
	 * (`person-cluster-rebuild`) processa. Grava o status `queued` para polling.
	 */
	async requestRebuild(collectionId: string): Promise<void> {
		const queueUrl = this.sqs.queueUrl.PERSON_REBUILD;

		if (!queueUrl) {
			throw new Error("PERSON_REBUILD_QUEUE não configurada");
		}

		await this.setRebuildStatus(collectionId, {
			status: "queued",
			queuedAt: new Date().toISOString(),
		});

		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({ collectionId }),
			}),
		);
	}

	/**
	 * Agenda um rebuild automático com **debounce**: cada face indexada chama
	 * isto, mas só o rebuild deve rodar uma vez, depois que os uploads param.
	 * Enfileira uma mensagem atrasada (`DelaySeconds`) e grava um marcador
	 * `PERSONREBUILD#PENDING` com um `token`; quando a mensagem "acorda", o
	 * worker só roda se o token dela ainda for o vigente (`runAutoRebuild`) —
	 * uploads posteriores sobrescrevem o token e invalidam as mensagens antigas,
	 * coalescendo o lote todo num rebuild só após a janela de silêncio.
	 *
	 * Enfileira antes de gravar o marcador: se o `PutItem` falhar, o marcador
	 * anterior continua válido e a mensagem dele roda — garante que ao menos um
	 * rebuild aconteça (o rebuild sempre lê as faces atuais, então qual mensagem
	 * "vence" não afeta a corretude, só evita rodar N vezes).
	 */
	async scheduleAutoRebuild(collectionId: string): Promise<void> {
		const queueUrl = this.sqs.queueUrl.PERSON_REBUILD;

		if (!queueUrl) {
			return; // rebuild automático desabilitado se a fila não existe
		}

		const token = `${new Date().toISOString()}-${randomUUID()}`;

		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				DelaySeconds: AUTO_REBUILD_QUIET_SECONDS,
				MessageBody: JSON.stringify({ collectionId, mode: "auto", token }),
			}),
		);

		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: REBUILD_PENDING_SK,
					Token: token,
				}),
			}),
		);
	}

	/**
	 * Executa um rebuild automático se a mensagem não estiver obsoleta. Compara
	 * o `token` da mensagem com o marcador vigente: se um upload mais novo já
	 * sobrescreveu o token, esta mensagem é descartada (a mais nova roda). Só
	 * apaga o marcador após um rebuild bem-sucedido, para que um erro reprocesse
	 * (o marcador segue válido enquanto não houver upload novo). Retorna se rodou.
	 */
	async runAutoRebuild(collectionId: string, token: string): Promise<boolean> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: REBUILD_PENDING_SK,
				}),
			}),
		);

		const currentToken = Item
			? (unmarshall(Item).Token as string | undefined)
			: undefined;

		if (currentToken !== token) {
			return false; // mensagem obsoleta: chegou upload mais novo depois dela
		}

		await this.processRebuild(collectionId);

		await this.dynamo.send(
			new DeleteItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: REBUILD_PENDING_SK,
				}),
			}),
		);

		return true;
	}

	async getRebuildStatus(collectionId: string): Promise<RebuildStatus | null> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: REBUILD_STATUS_SK,
				}),
			}),
		);

		if (!Item) {
			return null;
		}

		const { PK: _pk, SK: _sk, ...status } = unmarshall(Item);

		return status as RebuildStatus;
	}

	/**
	 * Executa o rebuild transicionando o status (running → done/failed). Chamado
	 * pelo worker da fila. Re-lança em caso de erro para o SQS reprocessar.
	 */
	async processRebuild(
		collectionId: string,
	): Promise<{ people: number; faces: number }> {
		await this.setRebuildStatus(collectionId, {
			status: "running",
			startedAt: new Date().toISOString(),
		});

		try {
			const summary = await this.rebuild(collectionId);

			await this.setRebuildStatus(collectionId, {
				status: "done",
				finishedAt: new Date().toISOString(),
				people: summary.people,
				faces: summary.faces,
			});

			return summary;
		} catch (error) {
			await this.setRebuildStatus(collectionId, {
				status: "failed",
				finishedAt: new Date().toISOString(),
				error: error instanceof Error ? error.message : String(error),
			});

			throw error;
		}
	}

	private async setRebuildStatus(
		collectionId: string,
		status: RebuildStatus,
	): Promise<void> {
		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall(
					{
						PK: `ALBUM#${collectionId}`,
						SK: REBUILD_STATUS_SK,
						...status,
					},
					{ removeUndefinedValues: true },
				),
			}),
		);
	}

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
			await this.putPerson(
				collectionId,
				cluster.map((faceId) => ({ faceId, imageId: imageOf.get(faceId) })),
			);
		}

		return { people: clusters.length, faces: faces.length };
	}

	/**
	 * Remove uma face dos clusters materializados — direito ao esquecimento
	 * (LGPD): após apagar o `FACE#`, a pessoa não pode continuar aparecendo na
	 * navegação por pessoa. Poda a face do `PERSON#` que a contém, reatribuindo
	 * a capa (menor `faceId`) e recalculando as fotos; apaga o cluster se ficar
	 * vazio. Retorna `false` se a face não estava em nenhum cluster.
	 */
	async removeFace(collectionId: string, faceId: string): Promise<boolean> {
		const records = await this.listPersonRecords(collectionId);

		const person = records.find(
			(record) =>
				(record.FaceIds ?? []).includes(faceId) ||
				(record.Faces ?? []).some((face) => face.faceId === faceId),
		);

		if (!person) {
			return false;
		}

		// A capa (personId) é o menor faceId, então podar pode trocar o personId
		// (que é a SK): apaga o registro atual antes de regravar.
		await this.deletePerson(collectionId, person.PersonId);

		// Registro legado sem o mapa face→imagem: não dá pra recalcular as fotos
		// com precisão, então derruba o cluster inteiro — o próximo rebuild o
		// repovoa já sem a face apagada.
		if (!person.Faces) {
			return true;
		}

		const remaining = person.Faces.filter((face) => face.faceId !== faceId);

		if (remaining.length > 0) {
			await this.putPerson(collectionId, remaining);
		}

		return true;
	}

	private async putPerson(
		collectionId: string,
		faces: PersonFaceRef[],
	): Promise<void> {
		const faceIds = faces.map((face) => face.faceId).sort();
		const personId = faceIds[0];
		const images = [
			...new Set(
				faces
					.map((face) => face.imageId)
					.filter((id): id is string => Boolean(id)),
			),
		].sort();

		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall(
					{
						PK: `ALBUM#${collectionId}`,
						SK: `PERSON#${personId}`,
						PersonId: personId,
						CoverFaceId: personId,
						CoverKey: coverKeyFor(collectionId, personId),
						FaceIds: faceIds,
						Faces: faces,
						Images: images,
						FaceCount: faceIds.length,
						PhotoCount: images.length,
						UpdatedAt: new Date().toISOString(),
					},
					{ removeUndefinedValues: true },
				),
			}),
		);
	}

	private async deletePerson(
		collectionId: string,
		personId: string,
	): Promise<void> {
		await this.dynamo.send(
			new DeleteItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${collectionId}`,
					SK: `PERSON#${personId}`,
				}),
			}),
		);
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

	private async listPersonRecords(
		collectionId: string,
	): Promise<PersonRecord[]> {
		const records: PersonRecord[] = [];
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
				records.push(unmarshall(item) as PersonRecord);
			}

			exclusiveStartKey = LastEvaluatedKey;
		} while (exclusiveStartKey);

		return records;
	}

	private async clearPeople(collectionId: string): Promise<void> {
		const existing = await this.listPeople(collectionId);

		await Promise.all(
			existing.map((person) =>
				this.deletePerson(collectionId, person.personId),
			),
		);
	}
}
