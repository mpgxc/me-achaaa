import type { APIGatewayProxyEvent } from "aws-lambda";

export const handler = async (event: APIGatewayProxyEvent) => {
	const token =
		event.headers?.Authorization || event.headers?.authorization || "";

	console.info(token);

	return {
		isAuthorized: true,
	};
};
