import { z } from "@hono/zod-openapi";

export const PersonSummarySchema = z
	.object({
		personId: z.string(),
		coverFaceId: z.string(),
		coverKey: z.string().describe("Chave S3 do recorte de rosto da capa"),
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
		images: z.array(z.string()),
	})
	.openapi("PersonPhotosResponse");

export const RebuildPeopleResponse = z
	.object({
		people: z.number(),
		faces: z.number(),
	})
	.openapi("RebuildPeopleResponse");

export const PersonParam = z.object({
	externalClientAlbumId: z.string().uuid(),
	personId: z.string().uuid(),
});
