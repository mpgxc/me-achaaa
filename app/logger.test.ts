import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, logger } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("logger", () => {
	it("emits structured JSON with level, msg and meta", () => {
		const spy = vi.spyOn(console, "info").mockImplementation(() => {});

		logger.info("hello", { key: "k1" });

		expect(spy).toHaveBeenCalledTimes(1);
		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("info");
		expect(parsed.msg).toBe("hello");
		expect(parsed.key).toBe("k1");
		expect(typeof parsed.time).toBe("string");
	});

	it("routes errors to console.error", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});

		logger.error("boom");

		const parsed = JSON.parse(spy.mock.calls[0][0] as string);
		expect(parsed.level).toBe("error");
		expect(parsed.msg).toBe("boom");
	});
});

describe("errorMessage", () => {
	it("returns the message of an Error", () => {
		expect(errorMessage(new Error("kaboom"))).toBe("kaboom");
	});

	it("stringifies non-Error values", () => {
		expect(errorMessage({ code: 42 })).toBe('{"code":42}');
	});
});
