import { randomUUID } from "node:crypto";
import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoSingleton } from "../../../providers";
import { generateApiKey, hashApiKey } from "./api-key";

export type TenantContext = { id: string };

/**
 * Gerencia tenants e suas API keys no mesmo single-table do DynamoDB:
 * - `PK=TENANT#{id}`,           `SK=METADATA` — registro do tenant
 * - `PK=APIKEY#{sha256(key)}`,  `SK=METADATA` — key -> tenant (só o hash)
 */
export class TenantService {
	constructor(private dynamo = DynamoSingleton.getInstance()) {}

	async createTenant({
		name,
		webhookUrl,
	}: {
		name: string;
		webhookUrl?: string;
	}): Promise<{ tenantId: string; apiKey: string }> {
		const tenantId = randomUUID();

		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall({
					PK: `TENANT#${tenantId}`,
					SK: "METADATA",
					Name: name,
					...(webhookUrl ? { WebhookUrl: webhookUrl } : {}),
					CreatedAt: new Date().toISOString(),
				}),
				ConditionExpression: "attribute_not_exists(PK)",
			}),
		);

		const apiKey = await this.issueApiKey(tenantId, { name: "default" });

		return { tenantId, apiKey };
	}

	/**
	 * Busca o registro de um tenant. Usado pelo NotificationDispatcher para
	 * resolver o `webhookUrl` de destino da notificação de conclusão.
	 */
	async getTenant(tenantId: string): Promise<{ webhookUrl?: string } | null> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({ PK: `TENANT#${tenantId}`, SK: "METADATA" }),
			}),
		);

		if (!Item) {
			return null;
		}

		const record = unmarshall(Item) as { WebhookUrl?: string };

		return { webhookUrl: record.WebhookUrl };
	}

	async issueApiKey(
		tenantId: string,
		{ name }: { name?: string } = {},
	): Promise<string> {
		const { plaintext, hash } = generateApiKey();

		await this.dynamo.send(
			new PutItemCommand({
				TableName: this.dynamo.tableName,
				Item: marshall({
					PK: `APIKEY#${hash}`,
					SK: "METADATA",
					TenantId: tenantId,
					Name: name ?? "default",
					CreatedAt: new Date().toISOString(),
				}),
			}),
		);

		return plaintext;
	}

	async resolveTenant(plaintextKey: string): Promise<TenantContext | null> {
		const hash = hashApiKey(plaintextKey);

		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({ PK: `APIKEY#${hash}`, SK: "METADATA" }),
			}),
		);

		if (!Item) {
			return null;
		}

		const record = unmarshall(Item) as { TenantId: string; Revoked?: boolean };

		if (record.Revoked) {
			return null;
		}

		return { id: record.TenantId };
	}
}
