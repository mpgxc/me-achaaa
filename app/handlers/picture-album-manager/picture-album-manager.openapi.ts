import { createRoute, z } from "@hono/zod-openapi";
import {
  ErrorResponse,
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
    params: z.object({
      externalClientAlbumId: z.string().uuid(),
    }),
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
