import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ACHIEVEMENT_BADGE_ART_V3 } from "./achievement-badge-prompts-v3.mjs";

const root = process.cwd();
const sourceDir = path.join(root, "scripts", "badge-sources", "achievement-v3");
const outputDir = path.join(root, "shinobij.client", "public", "badges");

async function main() {
    await mkdir(outputDir, { recursive: true });
    const failures = [];
    for (const { id } of ACHIEVEMENT_BADGE_ART_V3) {
        try {
            await sharp(path.join(sourceDir, `${id}.png`))
                .resize(256, 256, { fit: "cover", position: "attention" })
                .sharpen({ sigma: 0.65, m1: 0.7, m2: 1.4 })
                .webp({ quality: 88, effort: 6, smartSubsample: true })
                .toFile(path.join(outputDir, `${id}.webp`));
            console.log(`+ ${id}.webp`);
        } catch (error) {
            failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (failures.length > 0) throw new Error(`Missing or invalid generated sources:\n${failures.join("\n")}`);
    console.log(`achievement-badges-v3: finalized ${ACHIEVEMENT_BADGE_ART_V3.length} individually generated badges`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
