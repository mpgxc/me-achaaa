import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { OpenAPIHono } from "@hono/zod-openapi";
import { S3Singleton } from "../../providers";
import { apiKeyAuth } from "./auth/auth.middleware";
import { TenantService } from "./auth/tenant.service";
import type { AppEnv } from "./auth/types";
import { PersonClusteringService } from "./people/person-clustering.service";
import { PictureAlbumManagementService } from "./picture-album-management.service";
import {
	deleteAlbumFaceRoute,
	deleteAlbumRoute,
	generateUploadUrlRoute,
	getAlbumRoute,
	listAlbumFacesRoute,
	registerAlbumRoute,
} from "./picture-album-manager.openapi";
import { SearchCacheService } from "./search/search-cache.service";

export const pictureAlbumManagementRoute = new OpenAPIHono<AppEnv>();

const albumManagementService = new PictureAlbumManagementService();
const tenantService = new TenantService();
const cacheService = new SearchCacheService();
const peopleService = new PersonClusteringService();
const s3Client = S3Singleton.getInstance();

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 300; // 5 minutes

// Todas as rotas de álbum exigem uma API key válida e são escopadas ao tenant.
pictureAlbumManagementRoute.use("*", apiKeyAuth(tenantService));

pictureAlbumManagementRoute.openapi(registerAlbumRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.valid("json");
	const tenant = ctx.get("tenant");

	console.info(
		`Creating album with externalClientAlbumId: ${externalClientAlbumId}`,
	);

	try {
		const existing = await albumManagementService.getAlbum(
			externalClientAlbumId,
		);

		if (existing) {
			return ctx.json(
				{
					message: "Album already exists",
				},
				409,
			);
		}

		await albumManagementService.createRekognitionCollection(
			externalClientAlbumId,
		);

		await albumManagementService.createAlbumMetadata(
			externalClientAlbumId,
			tenant.id,
		);

		await albumManagementService.createBucketAlbum(externalClientAlbumId);

		return ctx.json(
			{
				message: "Album and Rekognition Collection created",
			},
			201,
		);
	} catch (error) {
		console.error("Error creating album:", error);

		await Promise.allSettled([
			albumManagementService.deleteRekognitionCollection(externalClientAlbumId),
			albumManagementService.deleteBucketAlbumPlaceholder(
				externalClientAlbumId,
			),
		]);

		console.info("Rollback: Rekognition collection and S3 placeholder deleted");

		return ctx.json(
			{
				message: "Failed to create album",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureAlbumManagementRoute.openapi(deleteAlbumRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	console.info(
		`Deleting album with externalClientAlbumId: ${externalClientAlbumId}`,
	);

	try {
		const album = await albumManagementService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json(
				{
					message: "Album does not exist",
				},
				404,
			);
		}

		await albumManagementService.deleteRekognitionCollection(
			externalClientAlbumId,
		);

		await albumManagementService.deleteBucketAlbum(externalClientAlbumId);
		await albumManagementService.deleteAlbumMetadata(externalClientAlbumId);

		return ctx.json(
			{
				message: "Album and Rekognition Collection deleted",
			},
			200,
		);
	} catch (error) {
		console.error("Error deleting album:", error);

		return ctx.json(
			{
				message: "Failed to delete album",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureAlbumManagementRoute.openapi(getAlbumRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumManagementService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json(
				{
					message: "Album not found",
				},
				404,
			);
		}

		return ctx.json(album.content, 200);
	} catch (error) {
		console.error("Error fetching album metadata:", error);

		return ctx.json(
			{
				message: "Failed to fetch album",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureAlbumManagementRoute.openapi(listAlbumFacesRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumManagementService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json(
				{
					message: "Album not found",
				},
				404,
			);
		}

		const faces = await albumManagementService.listAlbumFaces(
			externalClientAlbumId,
		);

		return ctx.json({ faces }, 200);
	} catch (error) {
		console.error("Error listing album faces:", error);

		return ctx.json(
			{
				message: "Failed to list album faces",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureAlbumManagementRoute.openapi(deleteAlbumFaceRoute, async (ctx) => {
	const { externalClientAlbumId, faceId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumManagementService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json({ message: "Album not found" }, 404);
		}

		const deleted = await albumManagementService.deleteFace(
			externalClientAlbumId,
			faceId,
		);

		if (!deleted) {
			return ctx.json({ message: "Face not found" }, 404);
		}

		// LGPD: a face já saiu do Rekognition/S3/Dynamo — agora limpa os dados
		// derivados (cache de busca + clusters) para ela parar de aparecer.
		// Best-effort: o esquecimento em si já foi feito, então uma falha aqui
		// (com o TTL do cache como rede de segurança) não deve reverter o 200.
		const cleanup = await Promise.allSettled([
			cacheService.invalidate(externalClientAlbumId),
			peopleService.removeFace(externalClientAlbumId, faceId),
		]);

		for (const result of cleanup) {
			if (result.status === "rejected") {
				console.error(
					"Erasure: falha ao limpar dados derivados da face:",
					result.reason,
				);
			}
		}

		return ctx.json({ message: "Face deleted" }, 200);
	} catch (error) {
		console.error("Error deleting face:", error);

		return ctx.json(
			{
				message: "Failed to delete face",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});

pictureAlbumManagementRoute.openapi(generateUploadUrlRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.param();
	const tenant = ctx.get("tenant");

	try {
		const album = await albumManagementService.getAlbum(externalClientAlbumId);

		if (!album || album.tenantId !== tenant.id) {
			return ctx.json(
				{
					message: "Album not found",
				},
				404,
			);
		}

		const imageId = randomUUID();
		const key = `uploads/incoming/${externalClientAlbumId}/${imageId}.jpg`;

		const command = new PutObjectCommand({
			Bucket: s3Client.bucketName,
			Key: key,
			ContentType: "image/jpeg",
		});

		const uploadUrl = await getSignedUrl(s3Client, command, {
			expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
		});

		return ctx.json({ uploadUrl, key }, 200);
	} catch (error) {
		console.error("Error generating upload URL:", error);

		return ctx.json(
			{
				message: "Failed to generate upload URL",
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
