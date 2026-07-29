import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const clientRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(clientRoot, "public/pet-models");
const ids = process.argv.slice(2);

if (!ids.length) throw new Error("Pass one or more starter model ids.");

function parseGlb(file, id) {
    if (file.subarray(0, 4).toString("ascii") !== "glTF" || file.readUInt32LE(4) !== 2) {
        throw new Error(`${id}: expected GLB v2`);
    }
    const jsonLength = file.readUInt32LE(12);
    return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
}

function meshSummary(json, mesh, index) {
    return {
        index,
        name: mesh.name ?? null,
        primitives: mesh.primitives.map((primitive) => {
            const accessor = json.accessors[primitive.attributes.POSITION];
            return {
                vertices: accessor.count,
                min: accessor.min ?? null,
                max: accessor.max ?? null,
                skinned: primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined,
            };
        }),
    };
}

for (const id of ids) {
    const json = parseGlb(await readFile(resolve(modelRoot, `${id}.glb`)), id);
    const meshNodes = json.nodes
        .map((node, index) => ({ index, ...node }))
        .filter((node) => node.mesh !== undefined)
        .map((node) => ({
            index: node.index,
            name: node.name ?? null,
            mesh: node.mesh,
            skin: node.skin ?? null,
            translation: node.translation ?? null,
            rotation: node.rotation ?? null,
            scale: node.scale ?? null,
        }));
    console.log(JSON.stringify({
        id,
        activeSceneRoots: json.scenes?.[json.scene ?? 0]?.nodes ?? [],
        meshes: json.meshes.map((mesh, index) => meshSummary(json, mesh, index)),
        meshNodes,
    }, null, 2));
}
