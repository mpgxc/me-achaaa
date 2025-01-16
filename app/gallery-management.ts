import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

// Configuração dos clientes AWS
const rekognition = new RekognitionClient({ region: "us-east-1" });
const dynamodb = new DynamoDBClient({ region: "us-east-1" });
const s3 = new S3Client({ region: "us-east-1" });

const TableName =
  "infra-face-rekognition-sls-dev-RekognitionBucketAssetsControll";

const createdAtIndex = "CreatedAtIndex";

export const createAlbum = async (Name: string, Description: string) => {
  const AlbumId = randomUUID();
  const CollectionId = `album-collection-${AlbumId}`;

  {
    const command = new CreateCollectionCommand({
      CollectionId,
      Tags: {
        Name,
        Description,
        CollectionId,
      },
    });

    await rekognition.send(command);
  }

  {
    const command = new PutItemCommand({
      TableName,
      Item: marshall({
        Name,
        Description,
        CollectionId,
        CreatedAt: new Date().toISOString(),
      }),
    });

    await dynamodb.send(command);
  }

  return {
    Name,
    AlbumId,
    Description,
  };
};

// Função para adicionar uma foto a um álbum
export const addPhoto = async (
  albumId: string,
  photoBuffer: Buffer,
  fileName: string
) => {
  const photoId = randomUUID();
  const imageBucketKey = `user/${albumId}/image_${photoId}.jpg`;
  const collectionId = `album-collection-${albumId}`;

  // Faz upload da foto para o S3
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: imageBucketKey,
      Body: photoBuffer,
    })
  );

  // Indexa os rostos na imagem usando Amazon Rekognition
  const faces = await indexFaces(collectionId, imageBucketKey);

  // Salva as informações da foto no DynamoDB

  const Item = marshall({
    CollectionId: collectionId,
    ImageId: photoId,
    imageBucketKey: imageBucketKey,
    faces: faces.map((face) => ({
      faceId: face.faceId,
      faceBucketKey: {
        S: `user/${albumId}/faces/face_${face.faceId}.jpg`,
      },
    })),
    CreatedAt: new Date().toISOString(),
  });

  await dynamodb.send(
    new PutItemCommand({
      TableName: tableName,
      Item,
    })
  );

  return { photoId, faces };
};

// Função para indexar rostos em uma imagem
const indexFaces = async (collectionId: string, imageBucketKey: string) => {
  const indexFacesResponse = await rekognition.send(
    new IndexFacesCommand({
      CollectionId: collectionId,
      Image: {
        S3Object: { Bucket: process.env.S3_BUCKET!, Name: imageBucketKey },
      },
      ExternalImageId: imageBucketKey,
      DetectionAttributes: ["ALL"],
    })
  );

  return (
    indexFacesResponse.FaceRecords?.map((faceRecord) => ({
      faceId: faceRecord.Face?.FaceId!,
      boundingBox: faceRecord.Face?.BoundingBox!,
    })) || []
  );
};

// Função para obter fotos de um álbum
export const getPhotos = async (albumId: string) => {
  const collectionId = `album-collection-${albumId}`;
  const queryCommand = new QueryCommand({
    TableName: tableName,
    IndexName: createdAtIndex,
    KeyConditionExpression: "CollectionId = :collectionId",
    ExpressionAttributeValues: {
      ":collectionId": { S: collectionId },
    },
  });

  const { Items } = await dynamodb.send(queryCommand);

  if (!Items?.length) {
    return [];
  }

  return Items.map((item) => unmarshall(item)).map((item) => ({
    imageId: item.ImageId,
    imageBucketKey: item.imageBucketKey,
    faces: item.faces.map((face: any) => ({
      faceId: face.faceId,
      faceBucketKey: face.faceBucketKey,
    })),
    createdAt: item.CreatedAt,
  }));
};

// Função para deletar uma foto
export const deletePhoto = async (albumId: string, photoId: string) => {
  const collectionId = `album-collection-${albumId}`;
  const imageBucketKey = `user/${albumId}/image_${photoId}.jpg`;

  // Deleta a foto do S3
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: imageBucketKey,
    })
  );

  // Obtém as faces associadas à foto
  const queryCommand = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression:
      "CollectionId = :collectionId AND ImageId = :imageId",
    ExpressionAttributeValues: marshall({
      ":collectionId": collectionId,
      ":imageId": photoId,
    }),
  });

  const { Items } = await dynamodb.send(queryCommand);

  if (!Items?.length) {
    return {
      message: "Photo not found",
    };
  }

  const faceIds = Items?.flatMap((item) => {
    const content = unmarshall(item);

    return content.faces.map((face: any) => face.faceId);
  });

  // Deleta as faces do Amazon Rekognition
  if (faceIds && faceIds.length > 0) {
    await rekognition.send(
      new DeleteFacesCommand({
        CollectionId: collectionId,
        FaceIds: faceIds,
      })
    );
  }

  // Deleta a entrada da foto no DynamoDB
  const deleteCommand = new DeleteItemCommand({
    TableName: tableName,
    Key: {
      CollectionId: { S: collectionId },
      ImageId: { S: photoId },
    },
  });
  await dynamodb.send(deleteCommand);

  return { message: "Photo deleted successfully" };
};
