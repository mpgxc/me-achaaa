import { OpenAPIHono } from "@hono/zod-openapi";
import { PictureAlbumManagementService } from "./picture-album-management.service";
import {
	deleteAlbumRoute,
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

		try {
			await albumManagementService.deleteRekognitionCollection(
				externalClientAlbumId,
			);

			console.info("Rollback: Rekognition collection deleted");
		} catch (rollbackError) {
			console.error(
				"Error rolling back Rekognition collection:",
				rollbackError,
			);
		}

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
