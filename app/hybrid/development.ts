import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  Face,
  FaceMatch,
  IndexFacesCommand,
  ListCollectionsCommand,
  ListFacesCommand,
  RekognitionClient,
  SearchFacesByImageCommand,
  SearchFacesCommand,
} from "@aws-sdk/client-rekognition";

const collectionId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const client = new RekognitionClient({
  region: "us-east-1",
});

async function listFacesInCollection(collectionId: string): Promise<Face[]> {
  const command = new ListFacesCommand({
    CollectionId: collectionId,
  });

  const { Faces } = await client.send(command);

  return Faces?.length ? Faces : [];
}

async function listCollections(): Promise<string[]> {
  const command = new ListCollectionsCommand();

  const { CollectionIds } = await client.send(command);

  return CollectionIds || [];
}

async function faceSearchByFaceId(
  FaceId: string,
  CollectionId: string
): Promise<FaceMatch[]> {
  const command = new SearchFacesCommand({
    FaceId,
    CollectionId,
    FaceMatchThreshold: 90,
  });

  const { FaceMatches } = await client.send(command);

  if (!FaceMatches?.length) {
    return [];
  }

  return FaceMatches;
}

async function indexFaces(
  CollectionId: string,
  ExternalImageId: string,
  Bytes: Buffer
): Promise<Face[]> {
  const command = new IndexFacesCommand({
    Image: {
      Bytes,
    },
    CollectionId,
    ExternalImageId,
    DetectionAttributes: ["ALL"],
  });

  const { FaceRecords } = await client.send(command);

  return FaceRecords?.length ? FaceRecords!.map(({ Face }) => Face!) : [];
}

async function deleteCollection(CollectionId: string): Promise<void> {
  const command = new DeleteCollectionCommand({
    CollectionId,
  });

  await client.send(command);
}

async function createCollection(CollectionId: string): Promise<void> {
  const command = new CreateCollectionCommand({
    CollectionId,
  });

  await client.send(command);
}

async function faceSearchByImage(
  CollectionId: string,
  Bytes: Buffer
): Promise<FaceMatch[]> {
  const command = new SearchFacesByImageCommand({
    CollectionId,
    Image: {
      Bytes,
    },
    FaceMatchThreshold: 90,
  });

  const { FaceMatches } = await client.send(command);

  if (!FaceMatches?.length) {
    return [];
  }

  return FaceMatches;
}

(async () => {
  {
    // const output = await deleteCollection(
    //   "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    // );

    const output = await listCollections();
    /*


      const output = await faceSearchByFaceId(
        "6a643cfb-b90c-4039-ad43-bef026ee54c9",l
        collectionId
        );

        console.table(output);
        */
    // const output = await listFacesInCollection(collectionId);
    // const output = await createCollection(collectionId);
    // const filename = __dirname + "/images/4.jpg";
    // const image = await readFile(filename);
    // const output = await indexFaces(
    //   collectionId,
    //   filename.split("/").pop()!,
    //   image
    // );
    // const image = await readFile(__dirname + "/images/search/who.png");
    // const output = await faceSearchByImage(collectionId, image);

    console.info(output);
  }
})();
