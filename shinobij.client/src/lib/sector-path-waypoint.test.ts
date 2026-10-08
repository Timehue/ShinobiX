import { test } from "node:test";
import assert from "node:assert/strict";
import { createSectorNavigator } from "./sector-path-waypoint";
import { isWalkableTile } from "../../../shared/sector-walk-mask";

test("a retargeted chaser finishes the step it is taking instead of turning back", () => {
    const navigate = createSectorNavigator();
    // Sector 14, row 8: open ground from column 6 to 10.
    const ahead = navigate(14, { col: 7, row: 8 }, { col: 10, row: 8 });
    assert.deepEqual(ahead, { col: 8, row: 8 });
    // Partway into that step the target swings behind it.
    assert.deepEqual(navigate(14, { col: 7.4, row: 8 }, { col: 6, row: 8 }), { col: 8, row: 8 });
    // Once the step lands, the new route turns it around.
    assert.deepEqual(navigate(14, { col: 8, row: 8 }, { col: 6, row: 8 }), { col: 7, row: 8 });
});

test("a chaser following a moving target only ever walks open ground and never reverses mid-step", () => {
    const navigate = createSectorNavigator();
    let position = { col: 6, row: 9 }, previous = { dc: 0, dr: 0 };
    // The target paces across the open southern field of sector 14.
    for (let frame = 0; frame < 600; frame++) {
        const target = { col: 6 + Math.round(4 * Math.abs(Math.sin(frame / 40))), row: 8 + (frame % 120 < 60 ? 0 : 2) };
        const next = navigate(14, position, target);
        assert(isWalkableTile(14, Math.round(next.row) * 12 + Math.round(next.col)), `routed onto blocked ${JSON.stringify(next)}`);
        const dc = next.col - position.col, dr = next.row - position.row, length = Math.hypot(dc, dr);
        if (length < 1e-9) continue;
        const step = Math.min(length, 5 / 60), move = { dc: dc / length * step, dr: dr / length * step };
        const midStep = !Number.isInteger(Math.round(position.col * 1e6) / 1e6) || !Number.isInteger(Math.round(position.row * 1e6) / 1e6);
        if (midStep) assert(move.dc * previous.dc + move.dr * previous.dr >= 0, `reversed at frame ${frame}`);
        position = { col: position.col + move.dc, row: position.row + move.dr };
        if (Math.abs(position.col - next.col) < 1e-6 && Math.abs(position.row - next.row) < 1e-6) position = next;
        previous = move;
    }
});
