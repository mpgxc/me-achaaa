import type { Face, FaceDetail } from "@aws-sdk/client-rekognition";

export type DynamoFaceRecord = {
	PK: string;
	SK: string;
	CollectionId: string;
	Confidence: number;
	CreatedAt: string;
	ExternalImageId: string;
	FaceId: string;
	ImageId: string;
};

export type DynamoItem = {
	PK: string;
	SK: string;
	Content: Content;
	Status: string;
	CreatedAt: string;
};

type Content = {
	photos: Photo[];
	faces: ContentFace[];
};

type Photo = {
	imageId: string;
	s3Key: string;
};

type ContentFace = {
	faceId: string;
	s3Key: string;
};

/**
 * Transactional Event Types
 * @describe These are the types used to define integration functions with SQS
 */

export type ImageProcessingFacesEvent = {
	Face: Face;
	FaceDetail: FaceDetail;
};

/**
 * @description This type is used to define the event that is sent to the SQS queue
 * @description From picture-index-processing.ts to image-extract-face.ts
 */
export type ImageProcessingEvent = {
	key: string;
	faces: Array<ImageProcessingFacesEvent>;
};
