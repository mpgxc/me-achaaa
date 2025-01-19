export type DynamoItem = {
  PK: string;
  SK: string;
  Content: Content;
  Status: string;
  CreatedAt: string;
};

type Content = {
  photos: Photo[];
  faces: Face[];
};

type Photo = {
  imageId: string;
  s3Key: string;
};

type Face = {
  faceId: string;
  s3Key: string;
};
