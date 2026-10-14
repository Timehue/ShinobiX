import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { repairAsset } from './repair-pet-skin-seams.mjs';

const client = resolve(import.meta.dirname, '..'), root = resolve(client, 'public/pet-models');
const option = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const candidates = resolve(client, option('root') ?? '.tmp/pet-performance-candidates/pet-models');
if (relative(resolve(client, '.tmp'), candidates).startsWith('..')) throw Error('Repair candidates must stay inside the workspace .tmp directory');
const audit = JSON.parse(await readFile(resolve(client, option('report') ?? '.tmp/pet-animation-audit/selected-pets-articulation-candidates-motion-audit.json')));
if (audit.failures.length || !audit.summary.geometryCoverage.startsWith('all vertices')) throw Error('Expected structurally valid complete-geometry evidence');
const recipes = [];
for (const id of new Set(audit.deformationWarnings.map(warning => warning.assetId))) {
    const model = runtimePetModels.find(row => row.model.visualId === id);
    const path = resolve(candidates, relative(root, model.path));
    const pairs = audit.deformationWarnings.filter(warning => warning.assetId === id).flatMap(warning => warning.worstEdges?.map(edge => edge.vertices) ?? []);
    if (!pairs.length) throw Error(`Missing measured edge evidence for ${id}`);
    const repaired = resolve(candidates, 'repaired', relative(candidates, path));
    const result = await repairAsset(path, repaired, 0, pairs);
    await copyFile(repaired, path);
    recipes.push({ id, pairs, changedVertices: result.changedVertices });
}
await mkdir(candidates, { recursive: true });
await writeFile(resolve(candidates, 'binding-repair-receipt.json'), JSON.stringify(recipes, null, 2));
console.log(JSON.stringify({ repaired: recipes.length, changedVertices: recipes.reduce((sum, row) => sum + row.changedVertices, 0) }));
