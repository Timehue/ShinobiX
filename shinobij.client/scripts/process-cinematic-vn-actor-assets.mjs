import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const argumentsList = process.argv.slice(2);
const chromaArgument = argumentsList.find((argument) => argument.startsWith("--chroma="));
const chromaMode = chromaArgument?.slice("--chroma=".length);
const pairs = argumentsList.filter((argument) => !argument.startsWith("--chroma="));

if (chromaMode && chromaMode !== "green" && chromaMode !== "magenta") {
    console.error("Chroma mode must be green or magenta.");
    process.exit(1);
}

if (!pairs.length || pairs.some((pair) => !pair.includes("="))) {
    console.error(
        "Usage: node scripts/process-cinematic-vn-actor-assets.mjs [--chroma=green|magenta] <output.webp=source.png> [...]",
    );
    process.exit(1);
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

async function removeChromaSpill(source) {
    const { data, info } = await sharp(source)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const alpha = data[index + 3];

        if (alpha === 0) {
            data[index] = 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            continue;
        }

        const keyChannel = chromaMode === "green" ? green : Math.min(red, blue);
        const comparisonChannel = chromaMode === "green" ? Math.max(red, blue) : green;
        const dominance = keyChannel - comparisonChannel;

        const spillThreshold = chromaMode === "green" ? 6 : 8;
        const removalRange = chromaMode === "green" ? 10 : 24;

        if (keyChannel < 36 || dominance <= spillThreshold) {
            continue;
        }
        // Red/blue skin values can be mildly magenta-dominant. Preserve fully
        // opaque material unless that dominance is extreme; chroma pollution
        // lives primarily in the antialiased matte pixels. Green-screen work
        // does not need this exception because natural skin is never green-led.
        if (chromaMode === "magenta" && alpha >= 248 && dominance < 72) {
            continue;
        }

        // Generated chroma mattes can leave a saturated one-pixel seam after
        // extraction. Fade that seam while neutralizing its hue so resampling
        // never turns it into a neon outline.
        const removal = Math.min(1, (dominance - spillThreshold) / removalRange);
        data[index + 3] = Math.round(alpha * (1 - removal));

        if (data[index + 3] === 0) {
            data[index] = 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            continue;
        }

        if (chromaMode === "green") {
            data[index + 1] = comparisonChannel;
        } else {
            data[index] = Math.min(red, green);
            data[index + 2] = Math.min(blue, green);
        }
    }

    return sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: 4,
        },
    });
}

for (const pair of pairs) {
    const separator = pair.indexOf("=");
    const output = path.resolve(pair.slice(0, separator));
    const source = path.resolve(pair.slice(separator + 1));

    await mkdir(path.dirname(output), { recursive: true });
    const sourceImage = chromaMode ? await removeChromaSpill(source) : sharp(source);
    const result = await sourceImage
        .trim({ background: transparent, threshold: 2 })
        .resize(1000, 1536, {
            fit: "contain",
            position: "bottom",
            background: transparent,
        })
        .webp({
            quality: 90,
            alphaQuality: 100,
            effort: 6,
            smartSubsample: true,
        })
        .toFile(output);

    console.log(
        `${output} | ${result.width}x${result.height} | ${result.size} bytes${chromaMode ? ` | ${chromaMode} despill` : ""}`,
    );
}
