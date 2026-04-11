import { OpenAPIHono } from "@hono/zod-openapi";
import { PictureAlbumManagementService } from "./picture-album-management.service";
import {
	deleteAlbumRoute,
	getAlbumRoute,
	listAlbumFacesRoute,
	registerAlbumRoute,
} from "./picture-album-manager.openapi";

export const pictureAlbumManagementRoute = new OpenAPIHono();

const albumManagementService = new PictureAlbumManagementService();

pictureAlbumManagementRoute.openapi(registerAlbumRoute, async (ctx) => {
	const { externalClientAlbumId } = ctx.req.valid("json");

	console.info(
		`Creating album with externalClientAlbumId: ${externalClientAlbumId}`,
	);

	try {
		const exists = await albumManagementService.checkAlbumExists(
			externalClientAlbumId,
		);

		if (exists) {
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

		await albumManagementService.createAlbumMetadata(externalClientAlbumId);

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

	console.info(
		`Deleting album with externalClientAlbumId: ${externalClientAlbumId}`,
	);

	try {
		const exists = await albumManagementService.checkAlbumExists(
			externalClientAlbumId,
		);

		if (!exists) {
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

	try {
		const content = await albumManagementService.getAlbumMetadata(
			externalClientAlbumId,
		);

		if (!content) {
			return ctx.json(
				{
					message: "Album not found",
				},
				404,
			);
		}

		return ctx.json(content, 200);
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

	try {
		const exists = await albumManagementService.checkAlbumExists(
			externalClientAlbumId,
		);

		if (!exists) {
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
