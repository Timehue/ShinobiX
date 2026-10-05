import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loiterPositionAt } from "./wanderer-loiter";

describe("passive wanderer loitering", () => {
    it("is repeatable at the same world time but changes across visits", () => {
        const at = (time: number) => loiterPositionAt("legacy-sage", 64, time);
        assert.deepEqual(at(1_000_000), at(1_000_000));
        const visited = new Set(Array.from({ length: 60 }, (_, i) => {
            const pose = at(1_000_000 + i * 1_000);
            return `${pose.col.toFixed(2)},${pose.row.toFixed(2)}`;
        }));
        assert.ok(visited.size > 12, "the same actor should be seen at several places along its route");
    });

    it("stays near its home tile and moves continuously", () => {
        for (const home of [26, 64, 105]) {
            const homeCol = home % 12;
            const homeRow = Math.floor(home / 12);
            let previous = loiterPositionAt(`actor-${home}`, home, 0);
            for (let time = 100; time <= 60_000; time += 100) {
                const pose = loiterPositionAt(`actor-${home}`, home, time);
                assert.ok(pose.col >= 1 && pose.col <= 10);
                assert.ok(pose.row >= 1 && pose.row <= 10);
                assert.ok(Math.hypot(pose.col - homeCol, pose.row - homeRow) <= 3);
                assert.ok(Math.hypot(pose.col - previous.col, pose.row - previous.row) <= 0.081,
                    "a route loop must not teleport the actor");
                previous = pose;
            }
        }
    });

    it("staggers different actors at the same home", () => {
        const a = loiterPositionAt("story-one", 64, 1_000_000);
        const b = loiterPositionAt("story-two", 64, 1_000_000);
        assert.notDeepEqual({ col: a.col, row: a.row }, { col: b.col, row: b.row });
    });
});
