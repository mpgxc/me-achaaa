import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ErrorResponse } from "../commons";
import { adminAuth } from "./auth.middleware";
import { CreateTenantRequest, CreateTenantResponse } from "./tenant.schemas";
import { TenantService } from "./tenant.service";
import type { AppEnv } from "./types";

const createTenantRoute = createRoute({
	tags: ["Tenants"],
	path: "/tenants",
	method: "post",
	request: {
		body: {
			content: {
				"application/json": {
					schema: CreateTenantRequest,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Tenant criado com sua primeira API key",
			content: {
				"application/json": {
					schema: CreateTenantResponse,
				},
			},
		},
		401: {
			description: "Credencial administrativa inválida",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		503: {
			description: "Provisionamento indisponível (ADMIN_API_KEY ausente)",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Erro interno",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const tenantManagementRoute = new OpenAPIHono<AppEnv>();

const tenantService = new TenantService();

// Provisionamento é uma operação administrativa: protegida por ADMIN_API_KEY.
tenantManagementRoute.use("/tenants", adminAuth());

tenantManagementRoute.openapi(createTenantRoute, async (ctx) => {
	const { name } = ctx.req.valid("json");

	try {
		const { tenantId, apiKey } = await tenantService.createTenant({ name });

		return ctx.json({ tenantId, apiKey, name }, 201);
	} catch (error) {
		console.error("Erro ao criar tenant:", error);

		return ctx.json(
			{
				message: "Falha ao criar tenant",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
