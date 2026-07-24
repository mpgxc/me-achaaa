import type { SQSEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProcessRebuild = vi.fn();
const mockRunAutoRebuild = vi.fn();

vi.mock("./picture-album-manager/people/person-clustering.service", () => ({
	PersonClusteringService: class {
		processRebuild = mockProcessRebuild;
		runAutoRebuild = mockRunAutoRebuild;
	},
}));

const { handler } = await import("./person-cluster-rebuild");

const sqsEvent = (body: unknown): SQSEvent =>
	({
		Records: [{ body: JSON.stringify(body), messageId: "m1" }],
	}) as SQSEvent;

beforeEach(() => {
	vi.clearAllMocks();
	mockProcessRebuild.mockResolvedValue({ people: 0, faces: 0 });
	mockRunAutoRebuild.mockResolvedValue(true);
});

describe("person-cluster-rebuild handler", () => {
	it("runs a manual rebuild via processRebuild", async () => {
		const res = await handler(sqsEvent({ collectionId: "col" }));

		expect(mockProcessRebuild).toHaveBeenCalledWith("col");
		expect(mockRunAutoRebuild).not.toHaveBeenCalled();
		expect(res.batchItemFailures).toEqual([]);
	});

	it("routes an auto message through the debounce (runAutoRebuild)", async () => {
		await handler(sqsEvent({ collectionId: "col", mode: "auto", token: "t" }));

		expect(mockRunAutoRebuild).toHaveBeenCalledWith("col", "t");
		expect(mockProcessRebuild).not.toHaveBeenCalled();
	});

	it("reports the message as a batch-item failure on error", async () => {
		mockProcessRebuild.mockRejectedValue(new Error("boom"));

		const res = await handler(sqsEvent({ collectionId: "col" }));

		expect(res.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
	});
});
