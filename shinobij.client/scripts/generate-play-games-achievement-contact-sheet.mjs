import sharp from "sharp";
import { fileURLToPath } from "node:url";

const iconDirectory = fileURLToPath(new URL("../../docs/play-games/achievement-icons/", import.meta.url));
const mappingsPath = fileURLToPath(new URL("../../docs/play-games/AchievementsIconsMappings.csv", import.meta.url));
const outputPath = fileURLToPath(new URL("../../docs/play-games/achievement-icons/contact-sheet-preview.png", import.meta.url));
const rows = (await import("node:fs/promises")).readFile(mappingsPath, "utf8").then((csv) =>
    csv.trim().split(/\r?\n/).map((line) => line.split(",")[1]),
);
const icons = await rows;
const cell = 136;
const size = 128;
const width = cell * 5;
const height = cell * Math.ceil(icons.length / 5);
const layers = await Promise.all(icons.map(async (icon, index) => ({
    input: await sharp(`${iconDirectory}/${icon}`).resize(size, size).png().toBuffer(),
    left: (index % 5) * cell + Math.floor((cell - size) / 2),
    top: Math.floor(index / 5) * cell + Math.floor((cell - size) / 2),
})));

await sharp({ create: { width, height, channels: 3, background: "#202225" } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
console.log(`Updated Play Games achievement preview: ${outputPath}`);
