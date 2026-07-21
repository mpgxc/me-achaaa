import { z } from "@hono/zod-openapi";

export const CreateTenantRequest = z
	.object({
		name: z.string().min(1),
		webhookUrl: z
			.string()
			.url()
			.optional()
			.describe("URL para receber notificações de conclusão de processamento"),
	})
	.openapi("CreateTenantRequest");

export const CreateTenantResponse = z
	.object({
		tenantId: z.string().uuid(),
		apiKey: z.string(),
		name: z.string(),
	})
	.openapi("CreateTenantResponse");
