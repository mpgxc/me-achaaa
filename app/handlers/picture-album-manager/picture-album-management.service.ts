import {
	type AttributeValue,
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

	/**
	 * Busca o álbum retornando o tenant dono (`tenantId`) junto do conteúdo,
	 * para que as rotas façam o escopo por tenant numa única leitura.
	 * `tenantId` é `null` em álbuns legados criados antes do multi-tenancy.
	 */
	async getAlbum(externalClientAlbumId: string): Promise<{
		tenantId: string | null;
		content: AlbumMetadataContent;
	} | null> {
		const { Item } = await this.dynamo.send(
			new GetItemCommand({
				TableName: this.dynamo.tableName,
				Key: marshall({
					PK: `ALBUM#${externalClientAlbumId}`,
					SK: "METADATA",
				}),
			}),
		);

		if (!Item) {
			return null;
		}

		const record = unmarshall(Item) as DynamoAlbumMetadataItem & {
			TenantId?: string;
		};

		return { tenantId: record.TenantId ?? null, content: record.Content };
	}

	async listAlbumFaces(
		externalClientAlbumId: string,
	): Promise<AlbumFaceRecord[]> {
		// Collect all DynamoDB face records across pages
		const dynamoItems: AlbumFaceRecord[] = [];
		let exclusiveStartKey: Record<string, AttributeValue> | undefined;

		do {
			const result = await this.dynamo.send(
				new QueryCommand({
					TableName: this.dynamo.tableName,
					KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
					ExpressionAttributeValues: marshall({
						":pk": `ALBUM#${externalClientAlbumId}`,
						":skPrefix": "FACE#",
					}),
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);

			for (const item of result.Items ?? []) {
				dynamoItems.push(unmarshall(item) as AlbumFaceRecord);
			}

			exclusiveStartKey = result.LastEvaluatedKey;
		} while (exclusiveStartKey);

		// Collect all Rekognition face IDs across pages
		const rekognitionFaceIds = new Set<string | undefined>();
		let nextToken: string | undefined;

		do {
			const result = await this.rekognition.send(
				new ListFacesCommand({
					CollectionId: externalClientAlbumId,
					NextToken: nextToken,
				}),
			);

			for (const face of result.Faces ?? []) {
				rekognitionFaceIds.add(face.FaceId);
			}

			nextToken = result.NextToken;
		} while (nextToken);

		return dynamoItems.filter((f) => rekognitionFaceIds.has(f.FaceId));
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

	async createAlbumMetadata(externalClientAlbumId: string, tenantId?: string) {
		const Item = marshall({
			PK: `ALBUM#${externalClientAlbumId}`,
			SK: "METADATA",
			...(tenantId ? { TenantId: tenantId } : {}),
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
							Key: `uploads/incoming/${externalClientAlbumId}/${s3Key}`,
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
