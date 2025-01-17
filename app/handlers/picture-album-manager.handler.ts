import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
} from "@aws-sdk/client-rekognition";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { DynamoSingleton, RekognitionSingleton } from "../providers";

const ALBUM_PREFIX = "ALBUM#";
const METADATA_SUFFIX = "METADATA";

type AlbumMetadata = {
  PK: string;
  SK: string;
  Content: {
    externalClientAlbumId: string;
  };
  CreatedAt: string;
};

const RegisterAlbumRequest = z
  .object({
    externalClientAlbumId: z.string().uuid(),
  })
  .openapi("Album");

const ErrorResponse = z
  .object({
    message: z.string(),
    error: z.any().optional(),
  })
  .openapi("ErrorResponse");

const SuccessResponse = z
  .object({
    message: z.string(),
  })
  .openapi("SuccessResponse");

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

export const routes = new OpenAPIHono();

class AlbumManagementService {
  constructor(
    private dynamo = DynamoSingleton.getInstance(),
    private rekognition = RekognitionSingleton.getInstance()
  ) {}

  async checkAlbumExists(albumId: string): Promise<boolean> {
    const command = new GetItemCommand({
      TableName: this.dynamo.tableName,
      Key: marshall({
        PK: `${ALBUM_PREFIX}${albumId}`,
        SK: METADATA_SUFFIX,
      }),
    });

    const { Item } = await this.dynamo.send(command);

    return !!Item;
  }

  async createRekognitionCollection(albumId: string): Promise<void> {
    const command = new CreateCollectionCommand({
      CollectionId: albumId,
      Tags: {
        Name: `collection-${albumId}`,
        Description: `Collection for storing faces for ${albumId}.`,
      },
    });

    await this.rekognition.send(command);
  }

  async createAlbumMetadata(albumId: string): Promise<void> {
    const Item = marshall({
      PK: `${ALBUM_PREFIX}${albumId}`,
      SK: METADATA_SUFFIX,
      Content: {
        externalClientAlbumId: albumId,
      },
      CreatedAt: new Date().toISOString(),
    });

    const command = new PutItemCommand({
      TableName: this.dynamo.tableName,
      Item,
    });

    await this.dynamo.send(command);
  }

  async deleteRekognitionCollection(albumId: string): Promise<void> {
    const command = new DeleteCollectionCommand({
      CollectionId: albumId,
    });

    await this.rekognition.send(command);
  }
}

const albumManagementService = new AlbumManagementService();

routes.openapi(route, async (ctx) => {
  const { externalClientAlbumId } = ctx.req.valid("json");

  console.info(
    `Creating album with externalClientAlbumId: ${externalClientAlbumId}`
  );

  try {
    const exists = await albumManagementService.checkAlbumExists(
      externalClientAlbumId
    );

    if (exists) {
      return ctx.json(
        {
          message: "Album already exists",
        },
        409
      );
    }

    await albumManagementService.createRekognitionCollection(
      externalClientAlbumId
    );

    await albumManagementService.createAlbumMetadata(externalClientAlbumId);

    return ctx.json(
      {
        message: "Album and Rekognition Collection created",
      },
      201
    );
  } catch (error) {
    console.error("Error creating album:", error);

    try {
      await albumManagementService.deleteRekognitionCollection(
        externalClientAlbumId
      );

      console.info("Rollback: Rekognition collection deleted");
    } catch (rollbackError) {
      console.error(
        "Error rolling back Rekognition collection:",
        rollbackError
      );
    }

    return ctx.json(
      {
        message: "Failed to create album",
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});
