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
