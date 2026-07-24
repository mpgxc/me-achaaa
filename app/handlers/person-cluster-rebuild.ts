import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { PersonClusteringService } from "./picture-album-manager/people/person-clustering.service";

const peopleService = new PersonClusteringService();

/**
 * Worker do rebuild de clusters de pessoas. Consome a `PersonRebuildQueue`
 * (publicada por `POST /albums/{id}/people/rebuild`) e roda o rebuild fora do
 * request — que é O(N) `SearchFaces` e não caberia nos ~29s do API Gateway.
 * Erros re-lançam via `batchItemFailures` para o SQS reprocessar (o status do
 * álbum fica `failed` até um retry bem-sucedido).
 */
export const handler = async ({
	Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	for (const { body, messageId } of Records) {
		try {
			const { collectionId, mode, token } = JSON.parse(body) as {
				collectionId: string;
				mode?: string;
				token?: string;
			};

			// "auto" passa pelo debounce (só roda se o token ainda for o vigente);
			// o rebuild manual (sem mode) sempre roda.
			if (mode === "auto" && token) {
				await peopleService.runAutoRebuild(collectionId, token);
			} else {
				await peopleService.processRebuild(collectionId);
			}
		} catch (error) {
			console.error(
				`PersonClusterRebuild: falha ao processar ${messageId}: ${
					error instanceof Error ? error.message : JSON.stringify(error)
				}`,
			);

			batchItemFailures.push({ itemIdentifier: messageId });
		}
	}

	return { batchItemFailures };
};
