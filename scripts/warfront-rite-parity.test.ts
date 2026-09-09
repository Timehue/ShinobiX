import assert from "node:assert/strict";
import { test } from "node:test";
import { runWarfrontRite as serverRun } from "../api/_pet-sim/pet-warfront-rite";
import { buildWarfrontAiTeam } from "../api/pet/_warfront-ai";
import { rawPetPool } from "../shinobij.client/src/data/pet-pool";
import { balanceBuiltInPetTemplate } from "../shinobij.client/src/lib/pet-balance";
import {
    runWarfrontRite as clientRun,
    WARFRONT_DEFAULT_DEPLOYMENT,
    type RitePlan,
} from "../shinobij.client/src/lib/pet-warfront-rite";

// Live playback and receipt authority run separate copies of the current Rite
// engine. Compare the entire replay, including every model's pose and health,
// so a successful legacy lane-mode parity test cannot conceal drift here.
const pool = rawPetPool.map(balanceBuiltInPetTemplate);
const blue = ["Earth", "Fire", "Water", "Wind"].map((element) => {
    const pet = pool.find((candidate) => candidate.element === element && candidate.rarity === "rare");
    assert.ok(pet, `missing real ${element} pet fixture`);
    return pet;
});
const red = buildWarfrontAiTeam(4);
const opening: RitePlan = {
    formation: [0, 1, 2, 3],
    deployment: [...WARFRONT_DEFAULT_DEPLOYMENT],
    reformAfterClash: null,
};
const reformed: RitePlan = {
    ...opening,
    reformAfterClash: 0,
    reformDeployment: [9, 6, 3, 0],
};

for (const seed of [1, 23, 98765]) {
    test(`current Warfront replay matches receipt authority, including re-form (seed ${seed})`, () => {
        let baseline: ReturnType<typeof clientRun> | undefined;
        for (const plan of [opening, { ...opening, deployment: [0, 2, 4, 8] }, reformed]) {
            const client = clientRun(structuredClone(blue), structuredClone(red), seed, structuredClone(plan));
            const server = serverRun(structuredClone(blue), structuredClone(red), seed, structuredClone(plan));
            assert.deepEqual(client, server, "client playback diverged from the server's sealed replay");
            assert.ok(client.clashes.length >= 2, "parity must include a complete best-of-three match");
            assert.ok(client.clashes.some((clash) => [...clash.blue, ...clash.red].some((pet) => pet.exitHp < 1)),
                "parity must cover actual combat damage");
            if (!baseline) baseline = client;
            if (plan === reformed) {
                assert.deepEqual(client.clashes[0], baseline.clashes[0], "a re-form cannot rewrite the opening clash");
                assert.deepEqual(client.clashes[1].blue.map((pet) => pet.node), reformed.reformDeployment,
                    "the next clash must render the deployment submitted for settlement");
            }
        }
    });
}
