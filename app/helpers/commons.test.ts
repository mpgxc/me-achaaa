import type { TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { splitBatches } from "./commons";

const makeItems = (count: number): TransactWriteItem[] =>
	Array.from({ length: count }, () => ({ Put: { TableName: "t", Item: {} } }));

describe("splitBatches", () => {
	it("returns an empty array when given an empty array", () => {
		expect(splitBatches([], 10)).toEqual([]);
	});

	it("puts all items into one batch when count is below batch size", () => {
		const items = makeItems(3);
		const result = splitBatches(items, 10);

		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(3);
	});

	it("splits items into multiple batches when count exceeds batch size", () => {
		const items = makeItems(7);
		const result = splitBatches(items, 3);

		expect(result).toHaveLength(3);
		expect(result[0]).toHaveLength(3);
		expect(result[1]).toHaveLength(3);
		expect(result[2]).toHaveLength(1);
	});

	it("creates exactly sized batches when items divide evenly", () => {
		const items = makeItems(6);
		const result = splitBatches(items, 2);

		expect(result).toHaveLength(3);
		expect(result.every((b) => b.length === 2)).toBe(true);
	});

	it("uses default batch size of 100 when not specified", () => {
		const items = makeItems(150);
		const result = splitBatches(items);

		expect(result).toHaveLength(2);
		expect(result[0]).toHaveLength(100);
		expect(result[1]).toHaveLength(50);
	});

	it("preserves item order across batches", () => {
		const items: TransactWriteItem[] = [
			{ Put: { TableName: "t", Item: { id: { N: "1" } } } },
			{ Put: { TableName: "t", Item: { id: { N: "2" } } } },
			{ Put: { TableName: "t", Item: { id: { N: "3" } } } },
		];
		const result = splitBatches(items, 2);

		expect(result[0][0].Put?.Item?.id).toEqual({ N: "1" });
		expect(result[0][1].Put?.Item?.id).toEqual({ N: "2" });
		expect(result[1][0].Put?.Item?.id).toEqual({ N: "3" });
	});
});
