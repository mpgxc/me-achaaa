/**
 * Contexto de autenticação injetado pelo middleware de API key.
 * `tenant` fica disponível em `ctx.get("tenant")` nas rotas autenticadas.
 */
export type AuthVariables = {
	tenant: { id: string };
};

export type AppEnv = {
	Variables: AuthVariables;
};
