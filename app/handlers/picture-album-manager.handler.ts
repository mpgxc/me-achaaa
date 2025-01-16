import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const RegisterAlbumRequest = z
  .object({
    externalClientAlbumId: z.string().uuid(),
  })
  .openapi("Album");

const route = createRoute({
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
    },
  },
});

export const routes = new OpenAPIHono();

routes.openapi(route, (ctx) => {
  const { externalClientAlbumId } = ctx.req.valid("json");

  console.log(
    `Creating album with externalClientAlbumId: ${externalClientAlbumId}`
  );

  return ctx.json(undefined, 201);
});
