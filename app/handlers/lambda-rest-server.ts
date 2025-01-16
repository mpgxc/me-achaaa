import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { routes } from "./picture-album-manager.handler";

const app = new OpenAPIHono({
  strict: true,
});

app.use(logger());
app.use(prettyJSON());
app.use(secureHeaders());
app.use(trimTrailingSlash());
app.use("*", requestId());

app.route("/", routes);

app.doc("/api/reference", {
  openapi: "3.1.0",
  info: {
    version: "2.0.0",
    title: "Album Manager API",
    description: "API to manage photo albums with A.I.",
  },
});

app.use("/api/docs", swaggerUI({ url: "/api/reference" }));

import("@scalar/hono-api-reference").then((module) => {
  app.get(
    "/api/docs/scalar",
    module.apiReference({
      theme: "kepler",
      layout: "modern",
      pageTitle: "Hono API Reference",
      spec: {
        url: "/api/reference",
      },
    })
  );
});

app.onError(async (err, ctx) => {
  console.error(err, `Error processing request ${ctx.req.routePath}`);

  if (err instanceof HTTPException) {
    return ctx.json(
      {
        message: err.message,
      },
      err.status
    );
  }

  if (err instanceof Error) {
    return ctx.json(
      {
        name: err.name,
        message: `${err.message} 🤯 Unexpected exception - please check the logs`,
      },
      500
    );
  }

  return ctx.json(
    {
      message: "Unexpected exception - please check the logs",
    },
    500
  );
});

app.notFound(async (ctx) => {
  return ctx.json(
    {
      message: "Route not found 🤷‍♂️",
    },
    404
  );
});

const port = 3000;

serve(
  {
    port,
    fetch: app.fetch,
  },
  (address) => {
    console.log(
      `🔥 Server listening on http://${address.address}:${address.port}/api/docs`
    );
  }
);
