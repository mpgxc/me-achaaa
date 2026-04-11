import type { TransactWriteItem } from "@aws-sdk/client-dynamodb";

export const extractExternalImageId = (key: string) => {
	const [CollectionId, ExternalImageId] = key
		.replace("uploads/incoming/", "")
		.replace(/\.jpe?g$/, "")
		.split("/");

	return {
		CollectionId,
		ExternalImageId,
	};
};

export const splitBatches = (items: TransactWriteItem[], batchSize = 100) => {
	return items.reduce((batches, item, index) => {
		const batchIndex = Math.floor(index / batchSize);

		if (!batches[batchIndex]) {
			batches[batchIndex] = [];
		}

		batches[batchIndex].push(item);

		return batches;
	}, [] as TransactWriteItem[][]);
};
