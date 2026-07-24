import { createRoute } from "@hono/zod-openapi";
import { AlbumIdParam, ErrorResponse } from "../commons";
import {
	ListPeopleResponse,
	PageQuery,
	PersonParam,
	PersonPhotosResponse,
	RebuildQueuedResponse,
	RebuildStatusResponse,
} from "./people.schemas";

export const listPeopleRoute = createRoute({
	tags: ["People"],
	path: "/albums/{externalClientAlbumId}/people",
	method: "get",
	request: {
		params: AlbumIdParam,
		query: PageQuery,
	},
	responses: {
		200: {
			description: "Pessoas (clusters de faces) do álbum — leitura cacheável",
			content: {
				"application/json": {
					schema: ListPeopleResponse,
				},
			},
		},
		400: {
			description: "Cursor de paginação inválido",
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

export const listPersonPhotosRoute = createRoute({
	tags: ["People"],
	path: "/albums/{externalClientAlbumId}/people/{personId}/photos",
	method: "get",
	request: {
		params: PersonParam,
		query: PageQuery,
	},
	responses: {
		200: {
			description: "Fotos de uma pessoa — leitura cacheável",
			content: {
				"application/json": {
					schema: PersonPhotosResponse,
				},
			},
		},
		400: {
			description: "Cursor de paginação inválido",
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
			description: "Coleção ou pessoa não encontrada",
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

export const rebuildPeopleRoute = createRoute({
	tags: ["People"],
	path: "/albums/{externalClientAlbumId}/people/rebuild",
	method: "post",
	request: {
		params: AlbumIdParam,
	},
	responses: {
		202: {
			description: "Rebuild enfileirado (roda de forma assíncrona)",
			content: {
				"application/json": {
					schema: RebuildQueuedResponse,
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

export const rebuildStatusRoute = createRoute({
	tags: ["People"],
	path: "/albums/{externalClientAlbumId}/people/rebuild/status",
	method: "get",
	request: {
		params: AlbumIdParam,
	},
	responses: {
		200: {
			description: "Status do último rebuild (idle se nunca rodou)",
			content: {
				"application/json": {
					schema: RebuildStatusResponse,
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
