import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { TenantService } from "./picture-album-manager/auth/tenant.service";
import { PictureAlbumManagementService } from "./picture-album-manager/picture-album-management.service";

/**
 * Entrega notificações de conclusão de processamento ao webhook do tenant.
 * Mesmo padrão do FailureNotification (SQS -> Lambda -> webhook), com retry
 * e DLQ do SQS garantindo a entrega. O tenant dono é resolvido a partir da
 * coleção do evento (coleção -> álbum -> TenantId -> webhookUrl).
 */

export type ProcessedNotification = {
	type: string;
	collectionId: string;
	imageId: string;
	faceIds: string[];
};

const albumService = new PictureAlbumManagementService();
const tenantService = new TenantService();

export const resolveWebhookUrl = async (
	collectionId: string,
): Promise<string | null> => {
	const album = await albumService.getAlbum(collectionId);

	if (!album?.tenantId) {
		return null;
	}

	const tenant = await tenantService.getTenant(album.tenantId);

	return tenant?.webhookUrl ?? null;
};

export const deliverNotification = async (
	webhookUrl: string,
	event: ProcessedNotification,
): Promise<void> => {
	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(event),
	});

	if (!response.ok) {
		throw new Error(`Webhook retornou HTTP ${response.status}`);
	}
};

export const handler = async ({
	Records,
}: SQSEvent): Promise<SQSBatchResponse> => {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	for (const { body, messageId } of Records) {
		try {
			const event = JSON.parse(body) as ProcessedNotification;

			const webhookUrl = await resolveWebhookUrl(event.collectionId);

			if (!webhookUrl) {
				console.info(
					`NotificationDispatcher: sem webhook para a coleção ${event.collectionId}, ignorando`,
				);

				continue;
			}

			await deliverNotification(webhookUrl, event);
		} catch (error) {
			console.error(
				`NotificationDispatcher: falha ao entregar ${messageId}: ${
					error instanceof Error ? error.message : JSON.stringify(error)
				}`,
			);

			batchItemFailures.push({ itemIdentifier: messageId });
		}
	}

	return { batchItemFailures };
};
