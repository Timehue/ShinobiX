import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    contractHunterWanderers,
    MAX_CONTRACT_HUNTERS_PER_SECTOR,
    type ContractHunterRosterEntry,
} from "./contract-hunter-wanderers.js";
import type { ContractHunterBounty } from "../../../shared/contract-hunter.js";

/*
 * Contract Hunter fan-out.
 *
 * Every hunter this returns becomes a <SectorWanderer>, and each of those owns a
 * requestAnimationFrame walk loop AND a ResizeObserver. Before the cap, a hub
 * sector holding 20 bountied players meant 20 extra 60fps callbacks writing
 * `style.transform` — roughly 1,200 layout-invalidating writes a second. The
 * lookup was also O(peers x board): a `bountyBoard.find()` per candidate, ~10,000
 * comparisons per recompute at 200 players.
 */

const SECTOR = 26;
const NOW = 1_800_000_000_000;
const tileFromKey = (key: string) => key.length % 144;

function bounty(target: string, amount: number, updatedAt = NOW - 1000): ContractHunterBounty {
    return { target, amount, updatedAt };
}
function peer(name: string, level = 20, currentSector: number | undefined = SECTOR): ContractHunterRosterEntry {
    return { name, level, currentSector };
}
function run(args: {
    board: ContractHunterBounty[];
    roster?: ContractHunterRosterEntry[];
    selfName?: string;
    cooldowns?: Record<string, number> | null;
}) {
    return contractHunterWanderers({
        sector: SECTOR,
        bountyBoard: args.board,
        self: { name: args.selfName ?? "Kaito", level: 30, wandererCooldowns: args.cooldowns ?? null },
        roster: args.roster ?? [],
        now: NOW,
        interiorTileFromKey: tileFromKey,
    });
}

describe("contractHunterWanderers: rendered fan-out is capped", () => {
    it("caps the rendered hunters per sector no matter how many peers are bountied", () => {
        const roster = Array.from({ length: 20 }, (_, i) => peer(`Peer${i}`));
        const board = roster.map((p, i) => bounty(p.name, 10_000 + i * 1_000));
        const out = run({ board, roster });
        assert.equal(out.length, MAX_CONTRACT_HUNTERS_PER_SECTOR);
        assert.ok(MAX_CONTRACT_HUNTERS_PER_SECTOR < 20, "the cap has to actually bite");
    });

    it("fills the slots by HIGHEST bounty first", () => {
        const roster = Array.from({ length: 12 }, (_, i) => peer(`Peer${i}`));
        // Peer11 is the richest head, Peer0 the poorest.
        const board = roster.map((p, i) => bounty(p.name, 5_000 * (i + 1)));
        const out = run({ board, roster });
        assert.deepEqual(
            out.map((w) => w.targetName),
            ["Peer11", "Peer10", "Peer9", "Peer8", "Peer7", "Peer6"].slice(0, MAX_CONTRACT_HUNTERS_PER_SECTOR),
        );
    });

    it("the VIEWER's own hunter always takes a slot, even as the poorest head", () => {
        const roster = Array.from({ length: 20 }, (_, i) => peer(`Peer${i}`));
        const board = [bounty("Kaito", 1), ...roster.map((p, i) => bounty(p.name, 900_000 - i))];
        const out = run({ board, roster });
        assert.equal(out.length, MAX_CONTRACT_HUNTERS_PER_SECTOR);
        assert.equal(out[0].targetName, "Kaito");
        assert.equal(out[0].verb, "bountyHunter", "only the target can engage their own hunter");
        assert.equal(out.filter((w) => w.verb === "bountyHunter").length, 1);
        for (const w of out.slice(1)) assert.equal(w.verb, "watch");
    });

    it("every client in the sector trims to the SAME set regardless of roster order", () => {
        const roster = Array.from({ length: 15 }, (_, i) => peer(`Peer${i}`));
        const board = roster.map((p, i) => bounty(p.name, 20_000 + i * 100));
        const forward = run({ board, roster }).map((w) => w.id);
        const reversed = run({ board: [...board].reverse(), roster: [...roster].reverse() }).map((w) => w.id);
        assert.deepEqual(forward, reversed);
    });

    it("ties break deterministically on the target name, not on arrival order", () => {
        const roster = Array.from({ length: 10 }, (_, i) => peer(`Peer${i}`));
        const board = roster.map((p) => bounty(p.name, 50_000)); // identical pools
        const a = run({ board, roster }).map((w) => w.targetName);
        const b = run({ board: [...board].reverse(), roster: [...roster].reverse() }).map((w) => w.targetName);
        assert.deepEqual(a, b);
        assert.deepEqual(a, [...a].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
    });
});

describe("contractHunterWanderers: behaviour preserved under the Map index", () => {
    it("an empty board short-circuits", () => {
        assert.deepEqual(run({ board: [], roster: [peer("Peer0")] }), []);
    });

    it("matches bounty targets case- and whitespace-insensitively", () => {
        const out = run({ board: [bounty("  kAiTo  ", 80_000)] });
        assert.equal(out.length, 1);
        assert.equal(out[0].targetName, "Kaito");
        assert.equal(out[0].bountyAmount, 80_000);
    });

    it("a duplicate board entry resolves to the FIRST one, as `find` did", () => {
        const out = run({ board: [bounty("Kaito", 80_000, NOW - 5_000), bounty("Kaito", 400_000, NOW - 1_000)] });
        assert.equal(out.length, 1);
        assert.equal(out[0].bountyAmount, 80_000);
    });

    it("ignores peers standing in another sector, and unbountied peers", () => {
        const out = run({
            board: [bounty("Elsewhere", 90_000), bounty("Here", 90_000)],
            roster: [peer("Elsewhere", 20, SECTOR + 1), peer("Here"), peer("Unbountied")],
        });
        assert.deepEqual(out.map((w) => w.targetName), ["Here"]);
    });

    it("never emits the viewer twice when the roster also lists them", () => {
        const out = run({ board: [bounty("Kaito", 90_000)], roster: [peer("kaito", 30)] });
        assert.deepEqual(out.map((w) => w.targetName), ["Kaito"]);
    });

    it("a zero / negative pool yields no hunter at all", () => {
        assert.deepEqual(run({ board: [bounty("Kaito", 0)] }), []);
        assert.deepEqual(run({ board: [bounty("Peer0", -5)], roster: [peer("Peer0")] }), []);
    });

    it("the viewer's own cooldown hides only THEIR hunter, never a bystander's", () => {
        const roster = [peer("Peer0")];
        const board = [bounty("Kaito", 90_000), bounty("Peer0", 90_000)];
        const uncooled = run({ board, roster });
        const mine = uncooled.find((w) => w.targetName === "Kaito")!;
        const cooled = run({ board, roster, cooldowns: { [mine.id]: NOW + 60_000 } });
        assert.deepEqual(cooled.map((w) => w.targetName), ["Peer0"]);
    });

    it("a cooled-out viewer frees their slot for one more peer", () => {
        const roster = Array.from({ length: 20 }, (_, i) => peer(`Peer${i}`));
        const board = [bounty("Kaito", 90_000), ...roster.map((p, i) => bounty(p.name, 10_000 + i))];
        const uncooled = run({ board, roster });
        const mine = uncooled.find((w) => w.targetName === "Kaito")!;
        const cooled = run({ board, roster, cooldowns: { [mine.id]: NOW + 60_000 } });
        assert.equal(uncooled.length, MAX_CONTRACT_HUNTERS_PER_SECTOR);
        assert.equal(cooled.length, MAX_CONTRACT_HUNTERS_PER_SECTOR);
        assert.ok(!cooled.some((w) => w.targetName === "Kaito"));
    });

    it("keeps the bystander label, tint and level derivation intact", () => {
        const out = run({ board: [bounty("Peer0", 150_000)], roster: [peer("Peer0", 40)] });
        assert.equal(out.length, 1);
        const w = out[0];
        assert.equal(w.name, "Contract Hunter — hunting Peer0");
        assert.equal(w.verb, "watch");
        assert.equal(w.tellTint, "var(--red-400)");
        assert.equal(w.avatarKey, "bountyHunter");
        assert.equal(w.level, 46); // 40 + 4 + floor(150k / 75k)
        assert.equal(w.homeTile, tileFromKey(`${w.id}:${SECTOR}`));
        assert.deepEqual(w.waypoints, [w.homeTile]);
        assert.ok(w.greeting.includes("150,000"));
    });

    it("stays linear in the board size — a 200-entry board is indexed once", () => {
        // Not a timing assertion: it counts how often the board is walked, by
        // making `target` a getter. One pass to index, and nothing after.
        let targetReads = 0;
        const board = Array.from({ length: 200 }, (_, i) => {
            const name = `Peer${i}`;
            return {
                get target() { targetReads++; return name; },
                amount: 10_000 + i,
                updatedAt: NOW - 1_000,
            } as ContractHunterBounty;
        });
        const roster = Array.from({ length: 200 }, (_, i) => peer(`Peer${i}`));
        const out = run({ board, roster });
        assert.equal(out.length, MAX_CONTRACT_HUNTERS_PER_SECTOR);
        // 200 to build the index + at most one confirming read per surviving
        // candidate — nowhere near the 200 x 201 the nested `find()` cost.
        assert.ok(targetReads < 600, `board scanned ${targetReads} times`);
    });
});
