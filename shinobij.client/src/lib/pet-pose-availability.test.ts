import assert from "node:assert/strict";
import { test } from "node:test";
import { POSED_PET_IDS } from "../assets/coliseum/pet-poses-manifest";
import { hasPetPose } from "./pet-pose-availability";

test("lightweight pose availability matches the generated production manifest", () => {
    for (const id of POSED_PET_IDS) assert.equal(hasPetPose(id), true, `missing generated pose id ${id}`);
    for (const id of [
        "standard-50",
        "rare-50",
        "legendary-30",
        "mythic-10",
        "starter-fire-xl",
        "generic-ai-pet-unknown",
    ]) assert.equal(hasPetPose(id), false, `unexpected pose id ${id}`);
});
