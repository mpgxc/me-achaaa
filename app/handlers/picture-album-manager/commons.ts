import { z } from "@hono/zod-openapi";

export const RegisterAlbumRequest = z
	.object({
		externalClientAlbumId: z.string().uuid(),
	})
	.openapi("RegisterAlbumRequest");

export const ErrorResponse = z
	.object({
		message: z.string(),
		error: z.any().optional(),
	})
	.openapi("ErrorResponse");

export const SuccessResponse = z
	.object({
		message: z.string(),
	})
	.openapi("SuccessResponse");

export const AlbumMetadataResponse = z
	.object({
		externalClientAlbumId: z.string(),
		photos: z.array(z.any()),
		faces: z.array(z.any()),
	})
	.openapi("AlbumMetadataResponse");

export const AlbumFaceRecord = z
	.object({
		FaceId: z.string(),
		ImageId: z.string().optional(),
		ExternalImageId: z.string().optional(),
		Confidence: z.number().optional(),
		CollectionId: z.string(),
		CreatedAt: z.string(),
	})
	.openapi("AlbumFaceRecord");

export const AlbumFacesResponse = z
	.object({
		faces: z.array(AlbumFaceRecord),
	})
	.openapi("AlbumFacesResponse");

export const GenerateUploadUrlRequest = z
	.object({})
	.openapi("GenerateUploadUrlRequest");

export const GenerateUploadUrlResponse = z
	.object({
		uploadUrl: z.string().url(),
		key: z.string(),
	})
	.openapi("GenerateUploadUrlResponse");

export const AlbumIdParam = z.object({
	externalClientAlbumId: z.string().uuid(),
});
