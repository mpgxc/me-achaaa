import { z } from "@hono/zod-openapi";

export const CollectionIdHeaders = z.object({
	"x-collection-id": z.string().uuid(),
});

export const SearchByImageRequest = z
	.object({
		image: z.string().min(1).describe("Imagem em base64 (data URI opcional)"),
	})
	.openapi("SearchByImageRequest");

export const SearchByImageResponse = z
	.object({
		images: z.array(z.string()),
	})
	.openapi("SearchByImageResponse");

export const SearchByFaceIdRequest = z
	.object({
		faceId: z.string().min(1),
	})
	.openapi("SearchByFaceIdRequest");

export const SearchMatchSchema = z
	.object({
		faceId: z.string().optional(),
		externalImageId: z.string().optional(),
		similarity: z.number().optional(),
	})
	.openapi("SearchMatch");

export const SearchByFaceIdResponse = z
	.object({
		matches: z.array(SearchMatchSchema),
	})
	.openapi("SearchByFaceIdResponse");
