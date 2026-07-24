import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guarda contra o modo de falha "deploy sobe handler vazio/faltando": se um
// handler do serverless.yml apontar para um módulo que não existe, ou se o
// package.yml deixar de empacotar o diretório compilado, o Lambda quebra em
// runtime com "Cannot find module". Estes testes tornam isso um erro de CI.

const root = process.cwd();
const serverless = readFileSync(resolve(root, "serverless.yml"), "utf8");
const packageManifest = readFileSync(resolve(root, "package.yml"), "utf8");

// Extrai os alvos de `handler:` do serverless.yml (ex.: build/handlers/foo.handler).
const handlerTargets = [...serverless.matchAll(/^\s+handler:\s*(\S+)/gm)].map(
	(match) => match[1],
);

describe("serverless packaging", () => {
	it("declara pelo menos um handler", () => {
		expect(handlerTargets.length).toBeGreaterThan(0);
	});

	it("todo handler aponta para um módulo-fonte existente em app/", () => {
		for (const target of handlerTargets) {
			// build/handlers/foo.handler → módulo build/handlers/foo (tira o export)
			const modulePath = target.replace(/\.[^.]+$/, "");
			// build/ é a saída compilada de app/ (tsconfig outDir).
			const source = `${modulePath.replace(/^build\//, "app/")}.ts`;

			expect(existsSync(resolve(root, source)), `${target} → ${source}`).toBe(
				true,
			);
		}
	});

	it("empacota o diretório compilado (build/**) que contém os handlers", () => {
		// Os handlers rodam a partir de build/ (tsconfig outDir); o package.yml
		// PRECISA incluir esse diretório — e não uma pasta dist/ inexistente,
		// como o gotcha antigo alertava.
		expect(handlerTargets.every((target) => target.startsWith("build/"))).toBe(
			true,
		);
		expect(packageManifest).toContain("build/**");
		expect(packageManifest).not.toContain("dist/app/handlers");
	});
});
