import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminAuth, apiKeyAuth } from "./auth.middleware";
import type { TenantService } from "./tenant.service";
import type { AppEnv } from "./types";

const makeProtectedApp = (resolveTenant: ReturnType<typeof vi.fn>) => {
	const app = new Hono<AppEnv>();
	app.use("*", apiKeyAuth({ resolveTenant } as unknown as TenantService));
	app.get("/protected", (ctx) => ctx.json({ tenant: ctx.get("tenant") }));

	return app;
};

describe("apiKeyAuth", () => {
	it("returns 401 when no key is provided", async () => {
		const resolveTenant = vi.fn();
		const res = await makeProtectedApp(resolveTenant).request("/protected");

		expect(res.status).toBe(401);
		expect(resolveTenant).not.toHaveBeenCalled();
	});

	it("returns 401 when the key is invalid", async () => {
		const resolveTenant = vi.fn().mockResolvedValue(null);
		const res = await makeProtectedApp(resolveTenant).request("/protected", {
			headers: { Authorization: "Bearer bad" },
		});

		expect(res.status).toBe(401);
	});

	it("injects the tenant when the Bearer key is valid", async () => {
		const resolveTenant = vi.fn().mockResolvedValue({ id: "t1" });
		const res = await makeProtectedApp(resolveTenant).request("/protected", {
			headers: { Authorization: "Bearer good" },
		});

		expect(res.status).toBe(200);
		expect((await res.json()).tenant).toEqual({ id: "t1" });
		expect(resolveTenant).toHaveBeenCalledWith("good");
	});

	it("accepts the key via the x-api-key header", async () => {
		const resolveTenant = vi.fn().mockResolvedValue({ id: "t2" });
		const res = await makeProtectedApp(resolveTenant).request("/protected", {
			headers: { "x-api-key": "k2" },
		});

		expect(res.status).toBe(200);
		expect(resolveTenant).toHaveBeenCalledWith("k2");
	});
});

describe("adminAuth", () => {
	const original = process.env.ADMIN_API_KEY;

	afterEach(() => {
		process.env.ADMIN_API_KEY = original;
	});

	const makeAdminApp = () => {
		const app = new Hono<AppEnv>();
		app.use("*", adminAuth());
		app.post("/tenants", (ctx) => ctx.json({ ok: true }));

		return app;
	};

	it("returns 503 when ADMIN_API_KEY is not configured", async () => {
		process.env.ADMIN_API_KEY = "";
		const res = await makeAdminApp().request("/tenants", { method: "POST" });

		expect(res.status).toBe(503);
	});

	it("returns 401 when the admin key is wrong", async () => {
		process.env.ADMIN_API_KEY = "secret";
		const res = await makeAdminApp().request("/tenants", {
			method: "POST",
			headers: { "x-admin-key": "nope" },
		});

		expect(res.status).toBe(401);
	});

	it("passes through when the admin key matches", async () => {
		process.env.ADMIN_API_KEY = "secret";
		const res = await makeAdminApp().request("/tenants", {
			method: "POST",
			headers: { "x-admin-key": "secret" },
		});

		expect(res.status).toBe(200);
	});
});
