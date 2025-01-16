import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  addPhoto,
  createAlbum,
  deletePhoto,
  getPhotos,
} from "./gallery-management";

const app = new Hono();

// Rota para criar um novo álbum
app.post("/albums", async (c) => {
  const { name, description } = await c.req.json();
  const result = await createAlbum(name, description);
  return c.json(result, 201);
});

// Rota para adicionar uma foto a um álbum
app.post("/albums/:albumId/photos", async (c) => {
  const { albumId } = c.req.param();
  const { fileName } = await c.req.json();
  const photoBuffer = await c.req.arrayBuffer();

  const buffer = Buffer.from(photoBuffer);

  const result = await addPhoto(albumId, buffer, fileName);

  return c.json(result, 201);
});

// Rota para listar fotos de um álbum
app.get("/albums/:albumId/photos", async (c) => {
  const { albumId } = c.req.param();
  const result = await getPhotos(albumId);
  return c.json(result, 200);
});

// Rota para deletar uma foto
app.delete("/albums/:albumId/photos/:photoId", async (c) => {
  const { albumId, photoId } = c.req.param();
  const result = await deletePhoto(albumId, photoId);
  return c.json(result, 200);
});

serve(
  {
    fetch: app.fetch.bind(app),
    port: 3000,
  },
  () => {
    console.log("Server running on http://localhost:3000");
  }
);
