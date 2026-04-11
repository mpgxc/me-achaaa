import {
	DeleteItemCommand,
	GetItemCommand,
	PutItemCommand,
	QueryCommand,
} from "@aws-sdk/client-dynamodb";
import {
	CreateCollectionCommand,
	DeleteCollectionCommand,
	ListFacesCommand,
} from "@aws-sdk/client-rekognition";
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
	DynamoSingleton,
	RekognitionSingleton,
	S3Singleton,
} from "../../providers";

type DynamoAlbumMetadataItem = {
	PK: string;
	SK: string;
	Content: AlbumMetadataContent;
	Status: string;
	CreatedAt: string;
};

type AlbumMetadataContent = {
	externalClientAlbumId: string;
	photos: Photo[];
	faces: Photo[];
};

type Photo = {
	s3Key: string;
	faced: string;
};

export type AlbumFaceRecord = {
	FaceId: string;
	ImageId: string;
	ExternalImageId: string;
	Confidence: number;
	CollectionId: string;
	CreatedAt: string;
};

export class PictureAlbumManagementService {
	constructor(
		private s3 = S3Singleton.getInstance(),
		private dynamo = DynamoSingleton.getInstance(),
		private rekognition = RekognitionSingleton.getInstance(),
	) {}

	async checkAlbumExists(externalClientAlbumId: string) {
		const command = new GetItemCommand({
			TableName: this.dynamo.tableName,
			Key: marshall({
				PK: `ALBUM#${externalClientAlbumId}`,
				SK: "METADATA",
			}),
		});

		const { Item } = await this.dynamo.send(command);

		return !!Item;
	}

	async getAlbumMetadata(
		externalClientAlbumId: string,
	): Promise<AlbumMetadataContent | null> {
		const command = new GetItemCommand({
			TableName: this.dynamo.tableName,
			Key: marshall({
				PK: `ALBUM#${externalClientAlbumId}`,
				SK: "METADATA",
			}),
		});

		const { Item } = await this.dynamo.send(command);

		if (!Item) {
			return null;
		}

		const { Content } = unmarshall(Item) as DynamoAlbumMetadataItem;

		return Content;
	}

	async listAlbumFaces(
		externalClientAlbumId: string,
	): Promise<AlbumFaceRecord[]> {
		const [dynamoResult, rekognitionResult] = await Promise.all([
			this.dynamo.send(
				new QueryCommand({
					TableName: this.dynamo.tableName,
					KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
					ExpressionAttributeValues: marshall({
						":pk": `ALBUM#${externalClientAlbumId}`,
						":skPrefix": "FACE#",
					}),
				}),
			),
			this.rekognition.send(
				new ListFacesCommand({
					CollectionId: externalClientAlbumId,
				}),
			),
		]);

		const rekognitionFaceIds = new Set(
			(rekognitionResult.Faces ?? []).map((f) => f.FaceId),
		);

		return (dynamoResult.Items ?? [])
			.map((item) => unmarshall(item) as AlbumFaceRecord)
			.filter((f) => rekognitionFaceIds.has(f.FaceId));
	}

	async createRekognitionCollection(
		externalClientAlbumId: string,
	): Promise<void> {
		const command = new CreateCollectionCommand({
			CollectionId: externalClientAlbumId,
			Tags: {
				Name: `collection-${externalClientAlbumId}`,
				Description: `Collection for storing faces for ${externalClientAlbumId}.`,
			},
		});

		await this.rekognition.send(command);
	}

	async deleteAlbumMetadata(externalClientAlbumId: string) {
		const command = new DeleteItemCommand({
			TableName: this.dynamo.tableName,
			Key: marshall({
				PK: `ALBUM#${externalClientAlbumId}`,
				SK: "METADATA",
			}),
		});

		await this.dynamo.send(command);
	}

	async createAlbumMetadata(externalClientAlbumId: string) {
		const Item = marshall({
			PK: `ALBUM#${externalClientAlbumId}`,
			SK: "METADATA",
			Content: {
				externalClientAlbumId,
				faces: [],
				photos: [],
			},
			CreatedAt: new Date().toISOString(),
		});

		const command = new PutItemCommand({
			TableName: this.dynamo.tableName,
			Item,
		});

		await this.dynamo.send(command);
	}

	async deleteRekognitionCollection(externalClientAlbumId: string) {
		const command = new DeleteCollectionCommand({
			CollectionId: externalClientAlbumId,
		});

		await this.rekognition.send(command);
	}

	async deleteBucketAlbum(externalClientAlbumId: string) {
		try {
			const command = new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${externalClientAlbumId}`,
					SK: "METADATA",
				}),
			});

			const { Item } = await this.dynamo.send(command);

			if (!Item) {
				throw new Error("Album not found");
			}

			const { Content } = unmarshall(Item) as DynamoAlbumMetadataItem;

			{
				const command = new DeleteObjectsCommand({
					Bucket: this.s3.bucketName,
					Delete: {
						Objects: Content.photos.map(({ s3Key }) => ({
							Key: `uploads/${externalClientAlbumId}/${s3Key}`,
						})),
						Quiet: true,
					},
				});

				await this.s3.send(command);
			}
		} catch (err) {
			console.error("Error deleting album from bucket:", err);

			throw err;
		}
	}

	/**
	 * @description Create a empty folder in the bucket for the album
	 * @param externalClientAlbumId  The external client album id
	 */
	async createBucketAlbum(externalClientAlbumId: string) {
		await this.s3.send(
			new PutObjectCommand({
				Bucket: this.s3.bucketName,
				Key: `uploads/${externalClientAlbumId}/`,
			}),
		);
	}

	/**
	 * @description Delete the S3 placeholder folder created by createBucketAlbum
	 * @param externalClientAlbumId  The external client album id
	 */
	async deleteBucketAlbumPlaceholder(externalClientAlbumId: string) {
		await this.s3.send(
			new DeleteObjectCommand({
				Bucket: this.s3.bucketName,
				Key: `uploads/${externalClientAlbumId}/`,
			}),
		);
	}
}
