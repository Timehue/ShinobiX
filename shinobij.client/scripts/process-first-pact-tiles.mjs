import sharp from "sharp";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "src/assets/first-pact/sunken-court-tile-atlas-source.png");
const target = resolve(process.argv[3] ?? "src/assets/first-pact/sunken-court-tile-atlas.webp");
const metadata = await sharp(source).metadata();
if (!metadata.width || metadata.width !== metadata.height) {
    throw new Error(`First Pact tile atlas must be square; received ${metadata.width}x${metadata.height}.`);
}
// Image generation can return an odd square size. Normalize once to a clean
// four-cell grid so runtime source rectangles never straddle adjacent art.
await sharp(source)
    .resize(1248, 1248, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 88, smartSubsample: true })
    .toFile(target);
