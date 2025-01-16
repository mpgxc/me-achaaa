import {
  RekognitionClient,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

const rekognitionClient = new RekognitionClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const COLLECTION_ID = process.env.REKOGNITION_COLLECTION!;

const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "Hello, human! 🦆 You are so far from home",
  })
);

app.notFound((c) =>
  c.json(
    {
      error: "Not Found 🦆",
    },
    404
  )
);

app.post(
  "/upload",
  bodyLimit({
    maxSize: 5 * 1024 * 1024,
    onError: (c) => {
      return c.json(
        {
          message: "O tamanho máximo do arquivo é de 5MB",
        },
        413
      );
    },
  }),
  async (ctx) => {
    const body = await ctx.req.parseBody();
    const file = body["file"] as File;

    try {
      const searchFacesOutput = await searchFacesByImage(COLLECTION_ID, file);

      const matchedImages =
        searchFacesOutput.FaceMatches?.map(
          (face) => face.Face?.ExternalImageId
        ) || [];

      return ctx.json({
        message: "Imagem processada com sucesso!",
        matched_images: matchedImages,
      });
    } catch (e) {
      const error = e as Error;

      console.error(`Erro ao processar a imagem: ${error}`);

      return ctx.json(
        {
          message: "Erro ao processar a imagem",
          error: error.message,
        },
        500
      );
    }
  }
);

const searchFacesByImage = async (collectionId: string, file: File) => {
  const command = new SearchFacesByImageCommand({
    CollectionId: collectionId,
    Image: {
      Bytes: await file.bytes(),
    },
    FaceMatchThreshold: 90,
    MaxFaces: 1,
  });

  return rekognitionClient.send(command);
};

// export const handler = handle(app);

serve(
  {
    fetch: app.fetch,
    port: 4000,
  },
  () => {
    console.log("Server is running on port 4000");
  }
);
