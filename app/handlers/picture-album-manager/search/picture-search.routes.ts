import { OpenAPIHono } from "@hono/zod-openapi";
import { apiKeyAuth } from "../auth/auth.middleware";
import { TenantService } from "../auth/tenant.service";
import type { AppEnv } from "../auth/types";
import { PictureAlbumManagementService } from "../picture-album-management.service";
import {
	searchByFaceIdRoute,
	searchByImageRoute,
} from "./picture-search.openapi";
import { PictureSearchService } from "./picture-search.service";

export const pictureSearchRoute = new OpenAPIHono<AppEnv>();

const albumService = new PictureAlbumManagementService();
const searchService = new PictureSearchService();
const tenantService = new TenantService();

const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

const decodeBase64Image = (input: string): Buffer =>
	Buffer.from(input.replace(/^data:image\/\w+;base64,/, ""), "base64");

// A busca é escopada ao tenant: só opera em coleções que ele possui.
pictureSearchRoute.use("*", apiKeyAuth(tenantService));

pictureSearchRoute.openapi(searchByImageRoute, async (ctx) => {
	const collectionId = ctx.req.valid("header")["x-collection-id"];
	const { image } = ctx.req.valid("json");
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(collectionId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Coleção não encontrada." }, 404);
		}

		const buffer = decodeBase64Image(image);

		if (buffer.byteLength > MAX_PAYLOAD_SIZE) {
			return ctx.json(
				{ message: "O tamanho do payload excede o limite de 5 MB." },
				413,
			);
		}

		const faces = await searchService.countFaces(buffer);

		if (faces === 0) {
			return ctx.json({ message: "Nenhuma face encontrada na imagem." }, 400);
		}

		if (faces > 1) {
			return ctx.json(
				{ message: "Mais de uma face encontrada na imagem." },
				400,
			);
		}

		const images = await searchService.searchByImage(collectionId, buffer);

		return ctx.json({ images }, 200);
	} catch (error) {
		console.error("Erro na busca por imagem:", error);

		return ctx.json(
			{
				message: "Erro ao processar a busca.",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureSearchRoute.openapi(searchByFaceIdRoute, async (ctx) => {
	const collectionId = ctx.req.valid("header")["x-collection-id"];
	const { faceId } = ctx.req.valid("json");
	const tenant = ctx.get("tenant");

	try {
		const album = await albumService.getAlbum(collectionId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Coleção não encontrada." }, 404);
		}

		const matches = await searchService.searchByFaceId(collectionId, faceId);

		return ctx.json({ matches }, 200);
	} catch (error) {
		console.error("Erro na busca por faceId:", error);

		return ctx.json(
			{
				message: "Erro ao processar a busca.",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
