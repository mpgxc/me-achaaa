import { createRoute } from "@hono/zod-openapi";
import { AlbumIdParam, ErrorResponse } from "../commons";
import {
	ListPeopleResponse,
	PersonParam,
	PersonPhotosResponse,
	RebuildPeopleResponse,
} from "./people.schemas";

export const listPeopleRoute = createRoute({
	tags: ["People"],
	path: "/albums/{externalClientAlbumId}/people",
	method: "get",
	request: {
		params: AlbumIdParam,
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
		200: {
			description: "Clusters de pessoas reconstruídos",
			content: {
				"application/json": {
					schema: RebuildPeopleResponse,
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
