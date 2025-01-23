export type SyncMetadataEvent = {
	bucket: string;
	/**
	 * The id of the image in the rekognition collection
	 */
	imageId: string;
	/**
	 * The key of the image in the bucket
	 */
	key: string;
};

export const handler = async (records: SyncMetadataEvent[]): Promise<void> => {
	console.log("SyncMetadataEvent", JSON.stringify(records, null, 2));
};
