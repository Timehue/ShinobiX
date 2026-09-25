// Reduce the fal source mesh before skinning. Never changes the provider GLB.
// Usage: node scripts/prepare-dawnmane-mesh.mjs [ratio] [max-error] [--replacement]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const replacement = process.argv.includes('--replacement');
const input = resolve(root, replacement ? "art-source/dawnmane-seraph/fal-replacement-source.glb" : "art-source/dawnmane-seraph/fal-source.glb");
const output = resolve(root, replacement ? "art-source/dawnmane-seraph/prepared-replacement-source.glb" : "art-source/dawnmane-seraph/prepared-source.glb");
const ratio = Number(process.argv[2] ?? 0.08);
const error = Number(process.argv[3] ?? 0.03);
if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error("Ratio must be between 0 and 1");
if (!Number.isFinite(error) || error <= 0 || error > 1) throw new Error("Max error must be between 0 and 1");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const primitive = document.getRoot().listMeshes()[0]?.listPrimitives()[0];
if (!primitive || document.getRoot().listMeshes().length !== 1) throw new Error("Expected one source mesh and primitive");
const before = { vertices: primitive.getAttribute("POSITION")?.getCount(), triangles: primitive.getIndices()?.getCount() / 3 };
await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
await document.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 88, effort: 5 }));
const reduced = document.getRoot().listMeshes()[0]?.listPrimitives()[0];
const after = { vertices: reduced?.getAttribute("POSITION")?.getCount(), triangles: reduced?.getIndices()?.getCount() / 3 };
if (!after.vertices || !after.triangles || after.vertices > 60_000 || after.vertices < 8_000 || after.triangles >= before.triangles) {
    throw new Error(`Simplified geometry misses the production vertex budget: ${JSON.stringify({ before, after })}`);
}
const bytes = await io.writeBinary(document);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes, { flag: "wx" });
console.log(JSON.stringify({ input, output, ratio, error, before, after, bytes: bytes.length }, null, 2));
