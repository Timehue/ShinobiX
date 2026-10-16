import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hasPetPose } from "./pet-pose-availability";

const POSE_DIR = fileURLToPath(new URL("../../public/pet-poses/", import.meta.url));
const IDLE_SUFFIX = "-idle.webp";

test("lightweight pose availability matches the idle art that ships", () => {
    const shippedIdle = new Set(readdirSync(POSE_DIR)
        .filter(file => file.endsWith(IDLE_SUFFIX))
        .map(file => file.slice(0, -IDLE_SUFFIX.length)));
    assert.ok(shippedIdle.size > 150, "the guard must see the real pose directory");

    // Every shipped idle cutout is reachable, and every accepted id has one on
    // disk, so a request built from hasPetPose never 404s.
    for (const id of shippedIdle) assert.equal(hasPetPose(id), true, `idle art not reachable: ${id}`);
    const roster = [
        ...["standard", "rare"].flatMap(prefix => Array.from({ length: 50 }, (_, index) => `${prefix}-${index}`)),
        ...Array.from({ length: 30 }, (_, index) => `legendary-${index}`),
        ...Array.from({ length: 16 }, (_, index) => `mythic-${index}`),
        ...["emberlynx", "guardhound", "sparrow"].map(name => `generic-ai-pet-${name}`),
        ...["earth", "fire", "lightning", "water", "wind"].flatMap(element => ["", "-r", "-l"].map(form => `starter-${element}${form}`)),
    ];
    for (const id of roster) {
        assert.equal(hasPetPose(id), true, `missing pose id ${id}`);
        assert.ok(shippedIdle.has(id), `accepted id has no idle art: ${id}`);
    }

    for (const id of [
        "standard-50",
        "rare-50",
        "legendary-30",
        "mythic-16",
        "starter-fire-xl",
        "generic-ai-pet-unknown",
    ]) assert.equal(hasPetPose(id), false, `unexpected pose id ${id}`);
});
