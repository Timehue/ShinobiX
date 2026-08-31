import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const argumentsList = process.argv.slice(2);
const chromaArgument = argumentsList.find((argument) => argument.startsWith("--chroma="));
const chromaMode = chromaArgument?.slice("--chroma=".length);
const qualityArgument = argumentsList.find((argument) => argument.startsWith("--quality="));
const quality = qualityArgument ? Number(qualityArgument.slice("--quality=".length)) : 90;
const pairs = argumentsList.filter((argument) => !argument.startsWith("--chroma=") && !argument.startsWith("--quality="));

if (chromaMode && chromaMode !== "green" && chromaMode !== "magenta" && chromaMode !== "checker") {
    console.error("Chroma mode must be green, magenta, or checker.");
    process.exit(1);
}

if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    console.error("Quality must be an integer from 1 to 100.");
    process.exit(1);
}

if (!pairs.length || pairs.some((pair) => !pair.includes("="))) {
    console.error(
        "Usage: node scripts/process-cinematic-vn-actor-assets.mjs [--chroma=green|magenta|checker] [--quality=1..100] <output.webp=source.png> [...]",
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

async function removeCheckerMatte(source) {
    const { data, info } = await sharp(source)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const pixelCount = info.width * info.height;
    const background = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    const isMatte = (pixel) => {
        const offset = pixel * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        return Math.min(red, green, blue) >= 205
            && Math.max(red, green, blue) - Math.min(red, green, blue) <= 20;
    };
    const enqueue = (pixel) => {
        if (pixel < 0 || pixel >= pixelCount || background[pixel] || !isMatte(pixel)) return;
        background[pixel] = 1;
        queue[tail++] = pixel;
    };

    for (let x = 0; x < info.width; x += 1) {
        enqueue(x);
        enqueue((info.height - 1) * info.width + x);
    }
    for (let y = 0; y < info.height; y += 1) {
        enqueue(y * info.width);
        enqueue(y * info.width + info.width - 1);
    }
    while (head < tail) {
        const pixel = queue[head++];
        const x = pixel % info.width;
        if (x > 0) enqueue(pixel - 1);
        if (x + 1 < info.width) enqueue(pixel + 1);
        enqueue(pixel - info.width);
        enqueue(pixel + info.width);
    }

    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if (!background[pixel]) continue;
        const offset = pixel * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
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
    const sourceImage = chromaMode === "checker"
        ? await removeCheckerMatte(source)
        : chromaMode
            ? await removeChromaSpill(source)
            : sharp(source);
    const result = await sourceImage
        .trim({ background: transparent, threshold: 2 })
        .resize(1000, 1536, {
            fit: "contain",
            position: "bottom",
            background: transparent,
        })
        .webp({
            quality,
            alphaQuality: 100,
            effort: 6,
            smartSubsample: true,
        })
        .toFile(output);

    console.log(
        `${output} | ${result.width}x${result.height} | ${result.size} bytes${chromaMode ? ` | ${chromaMode} despill` : ""}`,
    );
}
