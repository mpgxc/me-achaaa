import { OpenAPIHono } from "@hono/zod-openapi";
import { apiKeyAuth } from "../auth/auth.middleware";
import { TenantService } from "../auth/tenant.service";
import type { AppEnv } from "../auth/types";
import { PictureAlbumManagementService } from "../picture-album-management.service";
import {
	listPeopleRoute,
	listPersonPhotosRoute,
	rebuildPeopleRoute,
} from "./people.openapi";
import { PersonClusteringService } from "./person-clustering.service";

export const peopleManagementRoute = new OpenAPIHono<AppEnv>();

const albumService = new PictureAlbumManagementService();
const peopleService = new PersonClusteringService();
const tenantService = new TenantService();

// Os dados de "pessoas" só mudam num rebuild, então a navegação é cacheável.
// `private` porque a rota é autenticada por tenant; a camada pública de
// navegação (CDN) fica na frente disto — ver o diagrama browse × selfie.
const BROWSE_CACHE_CONTROL = "private, max-age=300";

peopleManagementRoute.use("*", apiKeyAuth(tenantService));

peopleManagementRoute.openapi(listPeopleRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Album not found" }, 404);
		}

		const people = await peopleService.listPeople(externalClientAlbumId);

		ctx.header("Cache-Control", BROWSE_CACHE_CONTROL);

		return ctx.json({ people }, 200);
	} catch (error) {
		console.error("Error listing people:", error);

		return ctx.json(
			{
				message: "Failed to list people",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

peopleManagementRoute.openapi(listPersonPhotosRoute, async (ctx) => {
	const { externalClientAlbumId, personId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Album not found" }, 404);
		}

		const person = await peopleService.getPersonPhotos(
			externalClientAlbumId,
			personId,
		);

		if (!person) {
			return ctx.json({ message: "Person not found" }, 404);
		}

		ctx.header("Cache-Control", BROWSE_CACHE_CONTROL);

		return ctx.json(person, 200);
	} catch (error) {
		console.error("Error listing person photos:", error);

		return ctx.json(
			{
				message: "Failed to list person photos",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

peopleManagementRoute.openapi(rebuildPeopleRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Album not found" }, 404);
		}

		const summary = await peopleService.rebuild(externalClientAlbumId);

		return ctx.json(summary, 200);
	} catch (error) {
		console.error("Error rebuilding people:", error);

		return ctx.json(
			{
				message: "Failed to rebuild people",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
