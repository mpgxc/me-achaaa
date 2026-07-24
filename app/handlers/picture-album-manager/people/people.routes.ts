import { OpenAPIHono } from "@hono/zod-openapi";
import { apiKeyAuth } from "../auth/auth.middleware";
import { TenantService } from "../auth/tenant.service";
import type { AppEnv } from "../auth/types";
import { PictureAlbumManagementService } from "../picture-album-management.service";
import {
	listPeopleRoute,
	listPersonPhotosRoute,
	rebuildPeopleRoute,
	rebuildStatusRoute,
} from "./people.openapi";
import { PersonClusteringService } from "./person-clustering.service";

export const peopleManagementRoute = new OpenAPIHono<AppEnv>();

const albumService = new PictureAlbumManagementService();
const peopleService = new PersonClusteringService();
const tenantService = new TenantService();

// Os dados de "pessoas" só mudam num rebuild, então a navegação é cacheável.
// `public` para o CloudFront (`PeopleBrowseDistribution`) guardar na borda; a
// chave de cache da distribuição inclui `Authorization`/`x-api-key`, então cada
// tenant tem sua entrada — e `Vary: Authorization` avisa qualquer proxy
// intermediário a particionar por credencial. As demais rotas (`private`/sem
// header) não são cacheadas: a distribuição respeita o Cache-Control da origem.
const BROWSE_CACHE_CONTROL = "public, max-age=300";

const setBrowseCacheHeaders = (ctx: {
	header: (name: string, value: string) => void;
}) => {
	ctx.header("Cache-Control", BROWSE_CACHE_CONTROL);
	ctx.header("Vary", "Authorization");
};

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

		setBrowseCacheHeaders(ctx);

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

		setBrowseCacheHeaders(ctx);

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

		// Enfileira e responde 202: o rebuild (O(N) SearchFaces) roda no worker,
		// senão estouraria o timeout do API Gateway em álbuns grandes.
		await peopleService.requestRebuild(externalClientAlbumId);

		return ctx.json({ status: "queued" as const }, 202);
	} catch (error) {
		console.error("Error requesting people rebuild:", error);

		return ctx.json(
			{
				message: "Failed to request people rebuild",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

peopleManagementRoute.openapi(rebuildStatusRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Album not found" }, 404);
		}

		const status = await peopleService.getRebuildStatus(externalClientAlbumId);

		return ctx.json(status ?? { status: "idle" as const }, 200);
	} catch (error) {
		console.error("Error fetching rebuild status:", error);

		return ctx.json(
			{
				message: "Failed to fetch rebuild status",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
