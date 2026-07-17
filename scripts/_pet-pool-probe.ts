/*
 * Emit the GAUNTLET_POOL table literal for api/_pet-sim/_gauntlet-pool.ts — the
 * server's copy of the balanced Pet Gauntlet draft pool. The api/ bundle can't
 * import the client (tsconfig.cpanel excludes shinobij.client), so we GENERATE
 * the balanced pool here from the client's own transform and paste it, guarded by
 * api/_pet-sim/_gauntlet-pool.test.ts against drift (same pattern as _card-probe).
 *
 * Regenerate with: node --import tsx scripts/_pet-pool-probe.ts  (then paste the
 * rows into _gauntlet-pool.ts).
 */
import { rawPetPool } from "../shinobij.client/src/data/pet-pool.js";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance.js";
import { derivePetRole } from "../shinobij.client/src/lib/pet-roles.js";
import { GAUNTLET_EXCLUDED_IDS } from "../shinobij.client/src/lib/pet-gauntlet.js";

const pets = rawPetPool.map(balanceBuiltInPetTemplate).filter((p) => !GAUNTLET_EXCLUDED_IDS.has(p.id));
const rows = pets.map((p) => {
    const role = (p.role as string | undefined) ?? derivePetRole(p).role;
    const jutsus = (p.jutsus ?? [])
        .map((j) => `{ name: ${JSON.stringify(j.name)}, kind: '${j.kind}', power: ${Math.round(j.power)}, cooldown: ${Math.round(j.cooldown)} }`)
        .join(", ");
    const element = p.element ? `'${p.element}'` : "null";
    return `    { id: '${p.id}', name: ${JSON.stringify(p.name)}, element: ${element}, rarity: '${p.rarity}', role: '${role}', hp: ${Math.round(p.hp)}, attack: ${Math.round(p.attack)}, defense: ${Math.round(p.defense)}, speed: ${Math.round(p.speed)}, jutsus: [${jutsus}] },`;
});
console.log(rows.join("\n"));
console.error(`generated ${rows.length} rows`);
