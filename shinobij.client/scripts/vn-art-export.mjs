// Export only explicitly selected approved generations; never overwrite old art.
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const manifest = JSON.parse(await readFile("../docs/art-audit/production.json", "utf8"));
const selected = new Set(process.argv.slice(2));
if (!selected.size) throw new Error("Pass approved asset keys from docs/art-audit/production.json");
const publicRoot = path.resolve("public");
for (const asset of manifest.assets.filter((a) => selected.has(a.key))) {
    if (!asset.source || !asset.asset.endsWith(".webp")) throw new Error(`Invalid export: ${asset.key}`);
    const output = path.resolve(publicRoot, asset.asset.slice(1));
    if (!output.startsWith(publicRoot + path.sep)) throw new Error("Export must stay under public/");
    await mkdir(path.dirname(output), { recursive: true });
    const portrait = asset.asset.startsWith("/portraits/");
    let image = sharp(asset.source);
    if (portrait && !(await image.metadata()).hasAlpha) throw new Error(`Portrait lacks alpha: ${asset.key}`);
    image = portrait ? image.resize({ height: 1100 }) : image.resize(1672, 941, { fit: "cover" });
    console.log(asset.key, await image.webp({ quality: portrait ? 90 : 88, alphaQuality: 100 }).toFile(output));
    selected.delete(asset.key);
}
if (selected.size) throw new Error(`Unknown asset keys: ${[...selected].join(", ")}`);
