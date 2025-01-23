import type { SQSEvent } from "aws-lambda";

type DiscordEmbedField = {
	name: string;
	value: string;
};

type DiscordMessage = {
	content: string;
	embeds: Array<{
		title: string;
		description: string;
		color: number;
		fields: DiscordEmbedField[];
	}>;
};

type ProcessingResult = {
	messageId: string;
	status: "Success" | "Failed";
	discordResponse?: number;
	error?: string;
};

export const handler = async (event: SQSEvent) => {
	/**
	 * @todo buscar o env via variável de ambiente process.env.DISCORD_WEBHOOK_URL
	 */
	const webhook =
		"https://discord.com/api/webhooks/1330356851963072543/vmQqEGxAhmTtQ2lU2H5SwjKZdTq7NdmiO31ZViJ4bqiHu7BpchQRLu7Qagzhxn9o--kj";

	const results: ProcessingResult[] = [];

	for (const record of event.Records) {
		try {
			const messageBody = record.body;

			const discordMessage: DiscordMessage = {
				content: "📢 **Mensagem da DLQ:**",
				embeds: [
					{
						title: "Erro no Processamento",
						description: "Mensagem movida para DLQ:",
						color: 15158332,
						fields: [
							{
								name: "Conteúdo da Mensagem",
								value: `\`\`\`json\n${messageBody}\n\`\`\``,
							},
							{
								name: "Recebida em",
								value: new Date().toISOString(),
							},
						],
					},
				],
			};

			const response = await fetch(webhook, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(discordMessage),
			});

			results.push({
				messageId: record.messageId,
				status: "Success",
				discordResponse: response.status,
			});
		} catch (e) {
			const error = e instanceof Error ? e : new Error(JSON.stringify(e));

			console.error(
				`Erro ao processar mensagem ID ${record.messageId}:`,
				error,
			);

			results.push({
				messageId: record.messageId,
				status: "Failed",
				error: error.message,
			});
		}
	}
};
