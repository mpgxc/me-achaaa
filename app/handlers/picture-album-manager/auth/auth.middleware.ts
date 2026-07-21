import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { TenantService } from "./tenant.service";
import type { AppEnv } from "./types";

const extractApiKey = (
	authorization?: string,
	apiKeyHeader?: string,
): string | null => {
	if (authorization?.startsWith("Bearer ")) {
		return authorization.slice("Bearer ".length).trim() || null;
	}

	return apiKeyHeader?.trim() || null;
};

/**
 * Autentica a requisição por API key (`Authorization: Bearer <key>` ou
 * `x-api-key`) e injeta o tenant resolvido em `ctx.get("tenant")`.
 */
export const apiKeyAuth = (tenantService: TenantService) =>
	createMiddleware<AppEnv>(async (ctx, next) => {
		const key = extractApiKey(
			ctx.req.header("authorization"),
			ctx.req.header("x-api-key"),
		);

		if (!key) {
			throw new HTTPException(401, {
				message:
					"API key ausente. Use Authorization: Bearer <key> ou o header x-api-key.",
			});
		}

		const tenant = await tenantService.resolveTenant(key);

		if (!tenant) {
			throw new HTTPException(401, { message: "API key inválida." });
		}

		ctx.set("tenant", tenant);

		await next();
	});

const safeEqual = (a: string, b: string): boolean => {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);

	return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Protege rotas administrativas (provisionamento de tenants) com o segredo
 * `ADMIN_API_KEY`, comparado em tempo constante para evitar timing attacks.
 */
export const adminAuth = () =>
	createMiddleware<AppEnv>(async (ctx, next) => {
		const adminKey = process.env.ADMIN_API_KEY;

		if (!adminKey) {
			throw new HTTPException(503, {
				message:
					"Provisionamento indisponível: ADMIN_API_KEY não está configurada.",
			});
		}

		const provided = ctx.req.header("x-admin-key");

		if (!provided || !safeEqual(provided, adminKey)) {
			throw new HTTPException(401, {
				message: "Credencial administrativa inválida.",
			});
		}

		await next();
	});
