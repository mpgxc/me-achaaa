import {
	DetectFacesCommand,
	SearchFacesByImageCommand,
	SearchFacesCommand,
} from "@aws-sdk/client-rekognition";
import { RekognitionSingleton } from "../../../providers";

const FACE_MATCH_THRESHOLD = 90;

export type SearchMatch = {
	faceId?: string;
	externalImageId?: string;
	similarity?: number;
};

/**
 * Lógica de busca facial via Rekognition, extraída dos antigos handlers
 * Lambda `picture-search.ts` para ser reutilizada dentro da API autenticada.
 */
export class PictureSearchService {
	constructor(private rekognition = RekognitionSingleton.getInstance()) {}

	async countFaces(image: Buffer): Promise<number> {
		const { FaceDetails } = await this.rekognition.send(
			new DetectFacesCommand({ Image: { Bytes: image } }),
		);

		return FaceDetails?.length ?? 0;
	}

	async searchByImage(collectionId: string, image: Buffer): Promise<string[]> {
		const { FaceMatches } = await this.rekognition.send(
			new SearchFacesByImageCommand({
				CollectionId: collectionId,
				Image: { Bytes: image },
				FaceMatchThreshold: FACE_MATCH_THRESHOLD,
			}),
		);

		return (FaceMatches ?? [])
			.map((match) => match.Face?.ExternalImageId)
			.filter((id): id is string => Boolean(id));
	}

	async searchByFaceId(
		collectionId: string,
		faceId: string,
	): Promise<SearchMatch[]> {
		const { FaceMatches } = await this.rekognition.send(
			new SearchFacesCommand({
				CollectionId: collectionId,
				FaceId: faceId,
				FaceMatchThreshold: FACE_MATCH_THRESHOLD,
			}),
		);

		return (FaceMatches ?? []).map((match) => ({
			faceId: match.Face?.FaceId,
			externalImageId: match.Face?.ExternalImageId,
			similarity: match.Similarity,
		}));
	}
}
