import { createRoute, z } from "@hono/zod-openapi";
import {
	AlbumFaceParam,
	AlbumFacesResponse,
	AlbumIdParam,
	AlbumMetadataResponse,
	ErrorResponse,
	GenerateUploadUrlRequest,
	GenerateUploadUrlResponse,
	RegisterAlbumRequest,
	SuccessResponse,
} from "./commons";

export const registerAlbumRoute = createRoute({
	tags: ["Albums"],
	path: "/albums",
	method: "post",
	request: {
		body: {
			content: {
				"application/json": {
					schema: RegisterAlbumRequest,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Album and Rekognition Collection created",
			content: {
				"application/json": {
					schema: SuccessResponse,
				},
			},
		},
		409: {
			description: "Album already exists",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		400: {
			description: "Bad Request",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const deleteAlbumRoute = createRoute({
	tags: ["Albums"],
	path: "/albums/{externalClientAlbumId}",
	method: "delete",
	request: {
		params: AlbumIdParam,
	},
	responses: {
		200: {
			description: "Album and Rekognition Collection deleted",
			content: {
				"application/json": {
					schema: SuccessResponse,
				},
			},
		},
		400: {
			description: "Bad Request",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		404: {
			description: "Album not found",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const getAlbumRoute = createRoute({
	tags: ["Albums"],
	path: "/albums/{externalClientAlbumId}",
	method: "get",
	request: {
		params: AlbumIdParam,
	},
	responses: {
		200: {
			description: "Album metadata",
			content: {
				"application/json": {
					schema: AlbumMetadataResponse,
				},
			},
		},
		404: {
			description: "Album not found",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const listAlbumFacesRoute = createRoute({
	tags: ["Albums"],
	path: "/albums/{externalClientAlbumId}/faces",
	method: "get",
	request: {
		params: AlbumIdParam,
	},
	responses: {
		200: {
			description: "List of indexed faces in the album",
			content: {
				"application/json": {
					schema: AlbumFacesResponse,
				},
			},
		},
		404: {
			description: "Album not found",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const deleteAlbumFaceRoute = createRoute({
	tags: ["Albums"],
	path: "/albums/{externalClientAlbumId}/faces/{faceId}",
	method: "delete",
	request: {
		params: AlbumFaceParam,
	},
	responses: {
		200: {
			description: "Face removida (Rekognition + S3 + DynamoDB)",
			content: {
				"application/json": {
					schema: SuccessResponse,
				},
			},
		},
		401: {
			description: "API key ausente ou inválida",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		404: {
			description: "Álbum ou face não encontrados",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const generateUploadUrlRoute = createRoute({
	tags: ["Albums"],
	path: "/albums/{externalClientAlbumId}/upload-url",
	method: "post",
	request: {
		params: AlbumIdParam,
		body: {
			content: {
				"application/json": {
					schema: GenerateUploadUrlRequest,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Pre-signed S3 upload URL",
			content: {
				"application/json": {
					schema: GenerateUploadUrlResponse,
				},
			},
		},
		404: {
			description: "Album not found",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		400: {
			description: "Bad Request",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Internal Server Error",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});
