import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "./api-key";

describe("generateApiKey", () => {
	it("returns a prefixed plaintext and its sha256 hash", () => {
		const { plaintext, hash } = generateApiKey();

		expect(plaintext.startsWith("sls_")).toBe(true);
		expect(hash).toHaveLength(64);
		expect(hash).toBe(hashApiKey(plaintext));
	});

	it("generates unique keys and hashes", () => {
		const a = generateApiKey();
		const b = generateApiKey();

		expect(a.plaintext).not.toBe(b.plaintext);
		expect(a.hash).not.toBe(b.hash);
	});
});

describe("hashApiKey", () => {
	it("is deterministic for the same input", () => {
		expect(hashApiKey("sls_abc")).toBe(hashApiKey("sls_abc"));
	});

	it("differs for different inputs", () => {
		expect(hashApiKey("sls_abc")).not.toBe(hashApiKey("sls_abd"));
	});

	it("never returns the plaintext itself", () => {
		expect(hashApiKey("sls_abc")).not.toBe("sls_abc");
	});
});
