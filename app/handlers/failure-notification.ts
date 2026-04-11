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

export const handler = async (event: SQSEvent) => {
	const webhook = process.env.DISCORD_WEBHOOK_URL;

	if (!webhook) {
		console.error("DISCORD_WEBHOOK_URL environment variable is not set");
		return;
	}

	for (const record of event.Records) {
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

		if (!response.ok) {
			throw new Error(
				`Discord webhook returned HTTP ${response.status} for message ${record.messageId}`,
			);
		}
	}
};
