/*
 * Emit the GAUNTLET_POOL table literal for api/_pet-sim/_gauntlet-pool.ts — the
 * server's copy of the balanced Pet Gauntlet draft pool. The api/ bundle can't
 * import the client (tsconfig.server excludes shinobij.client), so we GENERATE
 * the balanced pool here from the client's own transform, guarded by
 * api/_pet-sim/_gauntlet-pool.test.ts against drift (same pattern as _card-probe).
 *
 * Regenerate with: node --import tsx scripts/_pet-pool-probe.ts --write.
 * Without --write, print the generated rows for inspection.
 */
import { rawPetPool } from "../shinobij.client/src/data/pet-pool.js";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance.js";
import { derivePetRole } from "../shinobij.client/src/lib/pet-roles.js";
import { GAUNTLET_EXCLUDED_IDS } from "../shinobij.client/src/lib/pet-gauntlet.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pets = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => !GAUNTLET_EXCLUDED_IDS.has(p.id));
const rows = pets.map((p) => {
    const role = (p.role as string | undefined) ?? derivePetRole(p).role;
    const jutsus = (p.jutsus ?? [])
        .map((j) => `{ name: ${JSON.stringify(j.name)}, kind: '${j.kind}', power: ${Math.round(j.power)}, cooldown: ${Math.round(j.cooldown)} }`)
        .join(", ");
    const element = p.element ? `'${p.element}'` : "null";
    return `    { id: '${p.id}', name: ${JSON.stringify(p.name)}, element: ${element}, rarity: '${p.rarity}', role: '${role}', hp: ${Math.round(p.hp)}, attack: ${Math.round(p.attack)}, defense: ${Math.round(p.defense)}, speed: ${Math.round(p.speed)}, jutsus: [${jutsus}] },`;
});
if (process.argv.includes("--write")) {
    const path = fileURLToPath(new URL("../api/_pet-sim/_gauntlet-pool.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const table = /export const GAUNTLET_POOL: GauntletPoolPet\[\] = \[[\s\S]*?\r?\n\];/;
    if (!table.test(source)) throw new Error("Cannot locate the generated Gauntlet pool table.");
    writeFileSync(path, source.replace(table, `export const GAUNTLET_POOL: GauntletPoolPet[] = [\n${rows.join("\n")}\n];`));
} else console.log(rows.join("\n"));
console.error(`generated ${rows.length} rows`);
