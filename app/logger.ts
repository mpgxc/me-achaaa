/**
 * Logger estruturado mínimo (JSON) sem dependências de runtime.
 *
 * O `pino` está no package.json mas não é empacotado pelo `package.yml`
 * (que só inclui `zod` e `sharp` do node_modules), então importá-lo
 * quebraria os Lambdas em runtime. Este logger emite JSON via `console`,
 * que o CloudWatch Logs Insights consulta por campo da mesma forma.
 */

type LogLevel = "info" | "warn" | "error";

const emit = (
	level: LogLevel,
	msg: string,
	meta?: Record<string, unknown>,
): void => {
	const line = JSON.stringify({
		level,
		msg,
		time: new Date().toISOString(),
		...meta,
	});

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.info(line);
	}
};

/** Normaliza um erro desconhecido para uma string de mensagem. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : JSON.stringify(error);

export const logger = {
	info: (msg: string, meta?: Record<string, unknown>) =>
		emit("info", msg, meta),
	warn: (msg: string, meta?: Record<string, unknown>) =>
		emit("warn", msg, meta),
	error: (msg: string, meta?: Record<string, unknown>) =>
		emit("error", msg, meta),
};
