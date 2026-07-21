import { createRoute } from "@hono/zod-openapi";
import { ErrorResponse } from "../commons";
import {
	CollectionIdHeaders,
	SearchByFaceIdRequest,
	SearchByFaceIdResponse,
	SearchByImageRequest,
	SearchByImageResponse,
} from "./picture-search.schemas";

export const searchByImageRoute = createRoute({
	tags: ["Search"],
	path: "/search",
	method: "post",
	request: {
		headers: CollectionIdHeaders,
		body: {
			content: {
				"application/json": {
					schema: SearchByImageRequest,
				},
			},
		},
	},
	responses: {
		200: {
			description: "IDs das imagens com faces similares",
			content: {
				"application/json": {
					schema: SearchByImageResponse,
				},
			},
		},
		400: {
			description: "Nenhuma face ou múltiplas faces na imagem",
			content: {
				"application/json": {
					schema: ErrorResponse,
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
			description: "Coleção não encontrada para o tenant autenticado",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		413: {
			description: "Payload excede o limite de 5 MB",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Erro interno",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});

export const searchByFaceIdRoute = createRoute({
	tags: ["Search"],
	path: "/search/by-face-id",
	method: "post",
	request: {
		headers: CollectionIdHeaders,
		body: {
			content: {
				"application/json": {
					schema: SearchByFaceIdRequest,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Faces similares ao faceId informado",
			content: {
				"application/json": {
					schema: SearchByFaceIdResponse,
				},
			},
		},
		400: {
			description: "Requisição inválida",
			content: {
				"application/json": {
					schema: ErrorResponse,
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
			description: "Coleção não encontrada para o tenant autenticado",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
		500: {
			description: "Erro interno",
			content: {
				"application/json": {
					schema: ErrorResponse,
				},
			},
		},
	},
});
