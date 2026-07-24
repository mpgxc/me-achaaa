import { marshall } from "@aws-sdk/util-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DynamoSingleton,
	RekognitionSingleton,
	SqsSingleton,
} from "../../../providers";
import {
	PersonClusteringService,
	clusterFaces,
} from "./person-clustering.service";

vi.mock("../../../providers", () => ({
	DynamoSingleton: { getInstance: () => ({ send: vi.fn(), tableName: "t" }) },
	RekognitionSingleton: { getInstance: () => ({ send: vi.fn() }) },
	SqsSingleton: {
		getInstance: () => ({ send: vi.fn(), queueUrl: { PERSON_REBUILD: "url" } }),
	},
}));

describe("clusterFaces", () => {
	it("groups faces linked transitively into one person", () => {
		// a~b, b~c → {a,b,c}; d isolado → {d}
		const clusters = clusterFaces([
			{ faceId: "a", neighbors: ["b"] },
			{ faceId: "b", neighbors: ["c"] },
			{ faceId: "c", neighbors: [] },
			{ faceId: "d", neighbors: [] },
		]);

		expect(clusters).toEqual([["a", "b", "c"], ["d"]]);
	});

	it("keeps unrelated faces in separate clusters", () => {
		const clusters = clusterFaces([
			{ faceId: "x", neighbors: ["y"] },
			{ faceId: "y", neighbors: ["x"] },
			{ faceId: "z", neighbors: [] },
		]);

		expect(clusters).toEqual([["x", "y"], ["z"]]);
	});

	it("picks up neighbors not present as their own entry", () => {
		// 'b' aparece só como vizinho de 'a' — ainda deve entrar no cluster.
		expect(clusterFaces([{ faceId: "a", neighbors: ["b"] }])).toEqual([
			["a", "b"],
		]);
	});

	it("is deterministic regardless of input order", () => {
		const forward = clusterFaces([
			{ faceId: "a", neighbors: ["b"] },
			{ faceId: "c", neighbors: ["d"] },
		]);
		const backward = clusterFaces([
			{ faceId: "c", neighbors: ["d"] },
			{ faceId: "a", neighbors: ["b"] },
		]);

		expect(forward).toEqual(backward);
		expect(forward).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});
});

describe("PersonClusteringService", () => {
	const dynamoSend = vi.fn();
	const rekognitionSend = vi.fn();
	const sqsSend = vi.fn();
	let service: PersonClusteringService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new PersonClusteringService(
			{ send: dynamoSend, tableName: "t" } as unknown as DynamoSingleton,
			{ send: rekognitionSend } as unknown as RekognitionSingleton,
			{
				send: sqsSend,
				queueUrl: { PERSON_REBUILD: "queue-url" },
			} as unknown as SqsSingleton,
		);
	});

	describe("listPeople", () => {
		it("maps PERSON# records to lightweight summaries", async () => {
			dynamoSend.mockResolvedValue({
				Items: [
					marshall({
						PK: "ALBUM#col",
						SK: "PERSON#p1",
						PersonId: "p1",
						CoverFaceId: "p1",
						CoverKey: "uploads/faces/col/p1.jpg",
						FaceCount: 3,
						PhotoCount: 2,
					}),
				],
				LastEvaluatedKey: undefined,
			});

			expect(await service.listPeople("col")).toEqual([
				{
					personId: "p1",
					coverFaceId: "p1",
					coverKey: "uploads/faces/col/p1.jpg",
					faceCount: 3,
					photoCount: 2,
				},
			]);
		});
	});

	describe("getPersonPhotos", () => {
		it("returns the person's images on a hit", async () => {
			dynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "ALBUM#col",
					SK: "PERSON#p1",
					PersonId: "p1",
					Images: ["img-1", "img-2"],
				}),
			});

			expect(await service.getPersonPhotos("col", "p1")).toEqual({
				personId: "p1",
				images: ["img-1", "img-2"],
			});
		});

		it("returns null when the person does not exist", async () => {
			dynamoSend.mockResolvedValue({ Item: undefined });

			expect(await service.getPersonPhotos("col", "nope")).toBeNull();
		});
	});

	describe("rebuild", () => {
		it("clusters faces and materializes one PERSON# per cluster", async () => {
			// listFaceRows → duas faces da mesma pessoa (f1~f2) em imagens distintas.
			dynamoSend.mockImplementation((command) => {
				const sk = command.input.ExpressionAttributeValues?.[":sk"]?.S;

				if (sk === "FACE#") {
					return Promise.resolve({
						Items: [
							marshall({ FaceId: "f1", ExternalImageId: "img-1" }),
							marshall({ FaceId: "f2", ExternalImageId: "img-2" }),
						],
					});
				}

				// clearPeople (listPeople) e os PutItem/DeleteItem.
				return Promise.resolve({ Items: [] });
			});

			rekognitionSend.mockImplementation((command) => {
				const faceId = command.input.FaceId;

				return Promise.resolve({
					FaceMatches: [{ Face: { FaceId: faceId === "f1" ? "f2" : "f1" } }],
				});
			});

			const summary = await service.rebuild("col");

			expect(summary).toEqual({ people: 1, faces: 2 });

			// Grava exatamente uma pessoa, com capa = menor faceId e as 2 imagens.
			const put = dynamoSend.mock.calls
				.map(([command]) => command)
				.find((command) => command.input.Item?.SK?.S?.startsWith("PERSON#"));

			expect(put.input.Item.SK.S).toBe("PERSON#f1");
			expect(put.input.Item.CoverKey.S).toBe("uploads/faces/col/f1.jpg");
			expect(put.input.Item.PhotoCount.N).toBe("2");
			expect(put.input.Item.FaceCount.N).toBe("2");
		});
	});

	describe("removeFace", () => {
		const personRecord = (faces: { faceId: string; imageId?: string }[]) =>
			marshall(
				{
					PK: "ALBUM#col",
					SK: `PERSON#${faces.map((f) => f.faceId).sort()[0]}`,
					PersonId: faces.map((f) => f.faceId).sort()[0],
					FaceIds: faces.map((f) => f.faceId).sort(),
					Faces: faces,
					Images: [...new Set(faces.map((f) => f.imageId))].sort(),
				},
				{ removeUndefinedValues: true },
			);

		const commandsOf = (name: string) =>
			dynamoSend.mock.calls
				.map(([command]) => command)
				.filter((command) => command.constructor.name === name);

		it("prunes the face and reassigns the cover to the next smallest faceId", async () => {
			dynamoSend.mockImplementation((command) => {
				if (command.constructor.name === "QueryCommand") {
					return Promise.resolve({
						Items: [
							personRecord([
								{ faceId: "f1", imageId: "img-1" },
								{ faceId: "f2", imageId: "img-2" },
							]),
						],
					});
				}

				return Promise.resolve({});
			});

			expect(await service.removeFace("col", "f1")).toBe(true);

			// Apaga o registro antigo (personId = f1) e regrava sob a nova capa f2.
			expect(commandsOf("DeleteItemCommand")[0].input.Key.SK.S).toBe(
				"PERSON#f1",
			);
			const put = commandsOf("PutItemCommand")[0];
			expect(put.input.Item.SK.S).toBe("PERSON#f2");
			expect(put.input.Item.PhotoCount.N).toBe("1");
			expect(put.input.Item.FaceCount.N).toBe("1");
		});

		it("deletes the cluster when the removed face was its only member", async () => {
			dynamoSend.mockImplementation((command) => {
				if (command.constructor.name === "QueryCommand") {
					return Promise.resolve({
						Items: [personRecord([{ faceId: "f1", imageId: "img-1" }])],
					});
				}

				return Promise.resolve({});
			});

			expect(await service.removeFace("col", "f1")).toBe(true);
			expect(commandsOf("DeleteItemCommand")[0].input.Key.SK.S).toBe(
				"PERSON#f1",
			);
			expect(commandsOf("PutItemCommand")).toHaveLength(0);
		});

		it("returns false when the face is in no cluster", async () => {
			dynamoSend.mockImplementation((command) => {
				if (command.constructor.name === "QueryCommand") {
					return Promise.resolve({
						Items: [personRecord([{ faceId: "f9", imageId: "img-9" }])],
					});
				}

				return Promise.resolve({});
			});

			expect(await service.removeFace("col", "nope")).toBe(false);
			expect(commandsOf("DeleteItemCommand")).toHaveLength(0);
			expect(commandsOf("PutItemCommand")).toHaveLength(0);
		});
	});

	describe("requestRebuild", () => {
		it("marks the status queued and publishes to the queue", async () => {
			dynamoSend.mockResolvedValue({});
			sqsSend.mockResolvedValue({});

			await service.requestRebuild("col");

			const statusPut = dynamoSend.mock.calls
				.map(([command]) => command)
				.find(
					(command) => command.input.Item?.SK?.S === "PERSONREBUILD#STATUS",
				);
			expect(statusPut.input.Item.status.S).toBe("queued");

			const message = sqsSend.mock.calls[0][0];
			expect(message.input.QueueUrl).toBe("queue-url");
			expect(JSON.parse(message.input.MessageBody)).toEqual({
				collectionId: "col",
			});
		});

		it("throws when the queue is not configured", async () => {
			const svc = new PersonClusteringService(
				{ send: dynamoSend, tableName: "t" } as unknown as DynamoSingleton,
				{ send: rekognitionSend } as unknown as RekognitionSingleton,
				{ send: sqsSend, queueUrl: {} } as unknown as SqsSingleton,
			);

			await expect(svc.requestRebuild("col")).rejects.toThrow();
			expect(sqsSend).not.toHaveBeenCalled();
		});
	});

	describe("getRebuildStatus", () => {
		it("returns the stored status without the key attributes", async () => {
			dynamoSend.mockResolvedValue({
				Item: marshall({
					PK: "ALBUM#col",
					SK: "PERSONREBUILD#STATUS",
					status: "done",
					people: 3,
					faces: 7,
				}),
			});

			expect(await service.getRebuildStatus("col")).toEqual({
				status: "done",
				people: 3,
				faces: 7,
			});
		});

		it("returns null when there is no status yet", async () => {
			dynamoSend.mockResolvedValue({ Item: undefined });

			expect(await service.getRebuildStatus("col")).toBeNull();
		});
	});

	describe("processRebuild", () => {
		it("transitions running → done and stores the counts", async () => {
			// Sem faces: rebuild resolve rápido com { people: 0, faces: 0 }.
			dynamoSend.mockResolvedValue({ Items: [] });

			const summary = await service.processRebuild("col");

			expect(summary).toEqual({ people: 0, faces: 0 });

			const statuses = dynamoSend.mock.calls
				.map(([command]) => command)
				.filter(
					(command) => command.input.Item?.SK?.S === "PERSONREBUILD#STATUS",
				)
				.map((command) => command.input.Item.status.S);

			expect(statuses).toEqual(["running", "done"]);
		});

		it("marks the status failed and rethrows on error", async () => {
			dynamoSend.mockImplementation((command) => {
				// A leitura das faces falha → rebuild lança.
				if (command.constructor.name === "QueryCommand") {
					return Promise.reject(new Error("dynamo down"));
				}

				return Promise.resolve({});
			});

			await expect(service.processRebuild("col")).rejects.toThrow(
				"dynamo down",
			);

			const lastStatus = dynamoSend.mock.calls
				.map(([command]) => command)
				.filter(
					(command) => command.input.Item?.SK?.S === "PERSONREBUILD#STATUS",
				)
				.map((command) => command.input.Item.status.S)
				.at(-1);

			expect(lastStatus).toBe("failed");
		});
	});
});
