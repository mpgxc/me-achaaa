import { z } from "@hono/zod-openapi";

export const PersonSummarySchema = z
	.object({
		personId: z.string(),
		coverFaceId: z.string(),
		coverKey: z.string().describe("Chave S3 do recorte de rosto da capa"),
		coverUrl: z
			.string()
			.describe("URL assinada (GET) do recorte de rosto da capa"),
		faceCount: z.number(),
		photoCount: z.number(),
	})
	.openapi("PersonSummary");

export const ListPeopleResponse = z
	.object({
		people: z.array(PersonSummarySchema),
	})
	.openapi("ListPeopleResponse");

export const PersonPhotosResponse = z
	.object({
		personId: z.string(),
		images: z.array(z.string()).describe("IDs das fotos (ExternalImageId)"),
		photos: z
			.array(
				z.object({
					imageId: z.string(),
					url: z.string().describe("URL assinada (GET) do thumbnail"),
				}),
			)
			.describe("Fotos da pessoa com URL assinada do thumbnail"),
	})
	.openapi("PersonPhotosResponse");

export const RebuildQueuedResponse = z
	.object({
		status: z.literal("queued"),
	})
	.openapi("RebuildQueuedResponse");

export const RebuildStatusResponse = z
	.object({
		status: z.enum(["idle", "queued", "running", "done", "failed"]),
		queuedAt: z.string().optional(),
		startedAt: z.string().optional(),
		finishedAt: z.string().optional(),
		people: z.number().optional(),
		faces: z.number().optional(),
		error: z.string().optional(),
	})
	.openapi("RebuildStatusResponse");

export const PersonParam = z.object({
	externalClientAlbumId: z.string().uuid(),
	personId: z.string().uuid(),
});
