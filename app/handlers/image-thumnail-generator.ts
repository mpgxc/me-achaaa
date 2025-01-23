import sharp from "sharp";

const generateThumbnail = async (image: Uint8Array): Promise<Uint8Array> => {
	const thumbnail = await sharp(image)
		.resize({ width: 256, height: 256, fit: "inside" })
		.toBuffer();

	return thumbnail;
};

const generateThumbnailWithWaterMark = async (
	image: Uint8Array,
): Promise<Uint8Array> => {
	const watermarkPath = `${__dirname}/watermark.png`;
	const thumbnail = await sharp(image)
		.resize({ width: 256, height: 256, fit: "inside" })
		.composite([
			{
				input: watermarkPath,
				gravity: "southeast",
			},
		])
		.toBuffer();

	return thumbnail;
};
