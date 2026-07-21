import { createHash, randomBytes } from "node:crypto";

const API_KEY_PREFIX = "sls_";

/**
 * Gera uma nova API key. O texto puro (`plaintext`) é exibido ao cliente
 * apenas uma vez, no momento da criação; persista somente o `hash`.
 */
export const generateApiKey = (): { plaintext: string; hash: string } => {
	const plaintext = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;

	return { plaintext, hash: hashApiKey(plaintext) };
};

/**
 * Hash SHA-256 (hex) da API key, usado como chave de busca no DynamoDB.
 * Guardar o hash evita expor as keys em claro caso a tabela vaze.
 */
export const hashApiKey = (plaintext: string): string =>
	createHash("sha256").update(plaintext).digest("hex");
