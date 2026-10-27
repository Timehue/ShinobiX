import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, validateDeckIds, CHRONICLE_FIXED_FALLBACK_DECK, getChronicleCard } from "../../shared/chronicle-duel.js";
import {
    KEEPER_PATH_ACTS,
    KEEPER_PATH_CHRONICLE_POINTS,
    KEEPER_PATH_RESOLVE,
    KEEPER_PATH_ROWS,
    chooseKeeperBoon,
    chooseKeeperNode,
    emptyKeeperPath,
    keeperReachableNodes,
    settleKeeperFight,
    type KeeperPathRecord,
} from "../../shared/keeper-path-contract.js";
import { applyKeeperModifiers, generateKeeperMap, keeperOpponentDeck, newKeeperRun } from "./_keeper-path.js";

const DAY = Date.UTC(2026, 9, 26, 12);
const deck = [...CHRONICLE_FIXED_FALLBACK_DECK];
const fresh = (seed = 77): KeeperPathRecord => ({ ...emptyKeeperPath(), run: newKeeperRun("run1", seed, deck, DAY) });

test("the map is deterministic, three acts deep, and every node can be reached", () => {
    for (const seed of [1, 77, 4242, 99991]) {
        const nodes = generateKeeperMap(seed);
        assert.deepEqual(generateKeeperMap(seed), nodes, "same seed, same map");
        for (let act = 0; act < KEEPER_PATH_ACTS; act++) {
            for (let row = 0; row < KEEPER_PATH_ROWS; row++) {
                const rowNodes = nodes.filter((node) => node.act === act && node.row === row);
                assert.ok(rowNodes.length >= 2 && rowNodes.length <= 3);
                if (row === 0) assert.ok(rowNodes.every((node) => node.kind === "fight"), "each act opens with fights");
                else {
                    assert.equal(rowNodes.filter((node) => node.kind === "shrine").length, 1);
                    assert.ok(rowNodes.some((node) => node.kind !== "shrine"), "a row is never all shrines");
                }
                const next = row + 1 < KEEPER_PATH_ROWS ? nodes.filter((node) => node.act === act && node.row === row + 1) : [nodes.find((node) => node.id === `a${act}boss`)!];
                for (const target of next) assert.ok(rowNodes.some((node) => node.links.includes(target.id)), `${target.id} has a way in`);
                for (const node of rowNodes) assert.ok(node.links.length >= 1);
            }
        }
        for (const node of nodes.filter((entry) => entry.kind !== "shrine")) {
            const opponentDeck = keeperOpponentDeck(node.opponent!.key);
            assert.ok(opponentDeck && validateDeckIds(opponentDeck).valid, `${node.id} brings a legal deck`);
        }
        assert.equal(nodes.find((node) => node.id === `a${KEEPER_PATH_ACTS - 1}boss`)?.opponent?.key, "echoes-10-halden");
    }
});

test("a node must be reachable, a shrine offers three boons, and a boon is kept once chosen", () => {
    let record = fresh();
    const run = record.run!;
    const second = run.nodes.find((node) => node.act === 0 && node.row === 1)!;
    assert.equal(chooseKeeperNode(record, second.id).changed, false, "row two is not open from the start");
    const opening = keeperReachableNodes(run);
    assert.deepEqual(opening.map((node) => node.row), opening.map(() => 0));
    record = chooseKeeperNode(record, opening[0].id).record;
    assert.equal(record.run!.current, opening[0].id);
    assert.deepEqual(keeperReachableNodes(record.run!), [], "nothing else opens until the duel is won");
    record = settleKeeperFight(record, "run1", opening[0].id, "win", "p1", DAY).record;
    const shrine = keeperReachableNodes(record.run!).find((node) => node.kind === "shrine");
    if (shrine) {
        record = chooseKeeperNode(record, shrine.id).record;
        const offer = record.run!.boonOffer!;
        assert.equal(offer.length, 3);
        assert.equal(chooseKeeperBoon(record, "not-a-boon").changed, false);
        record = chooseKeeperBoon(record, offer[0]).record;
        assert.equal(record.run!.boons[offer[0]], 1);
        assert.equal(record.run!.boonOffer, null);
    }
});

test("a loss costs Resolve and keeps the node; losing all Resolve ends the run; a draw changes nothing", () => {
    let record = fresh();
    const node = keeperReachableNodes(record.run!)[0];
    record = chooseKeeperNode(record, node.id).record;
    record = settleKeeperFight(record, "run1", node.id, "draw", "d1", DAY).record;
    assert.equal(record.run!.resolve, KEEPER_PATH_RESOLVE);
    record = settleKeeperFight(record, "run1", node.id, "loss", "l1", DAY).record;
    assert.equal(record.run!.resolve, KEEPER_PATH_RESOLVE - 1);
    assert.equal(record.run!.current, node.id, "the same Keeper waits for a rematch");
    assert.equal(settleKeeperFight(record, "run1", node.id, "loss", "l1", DAY).changed, false, "a proof settles once");
    record = settleKeeperFight(record, "run1", node.id, "loss", "l2", DAY).record;
    assert.equal(record.run!.status, "lost");
    assert.equal(settleKeeperFight(record, "run1", node.id, "win", "w9", DAY).changed, false, "a lost run accepts nothing");
});

test("winning every fight completes the run, pays once a day and counts the first clear", () => {
    const walk = (start: KeeperPathRecord, now: number, tag: string) => {
        let record = start;
        let paid = 0;
        let firstClear = false;
        for (let guard = 0; guard < 40 && record.run!.status === "active"; guard++) {
            const run = record.run!;
            if (run.boonOffer) { record = chooseKeeperBoon(record, run.boonOffer[0]).record; continue; }
            const next = keeperReachableNodes(run).find((node) => node.kind !== "shrine") ?? keeperReachableNodes(run)[0];
            record = chooseKeeperNode(record, next.id).record;
            if (next.kind === "shrine") continue;
            const settled = settleKeeperFight(record, run.runId, next.id, "win", `${tag}-${guard}`, now);
            record = settled.record;
            paid += settled.chroniclePoints;
            firstClear ||= settled.firstClear;
        }
        return { record, paid, firstClear };
    };
    const first = walk(fresh(5), DAY, "a");
    assert.equal(first.record.run!.status, "won");
    assert.equal(first.record.clears, 1);
    assert.equal(first.paid, KEEPER_PATH_CHRONICLE_POINTS);
    assert.equal(first.firstClear, true);
    const again = walk({ ...first.record, run: newKeeperRun("run2", 6, deck, DAY) }, DAY + 60_000, "b");
    assert.equal(again.paid, 0, "a second clear the same UTC day pays nothing");
    assert.equal(again.firstClear, false);
    assert.equal(again.record.clears, 2);
});

test("boons change the fresh match before anyone acts", () => {
    const match = createMatch("Hero", deck, "Keeper", deck, () => 0.3, DAY);
    const before = { life: match.p1.lifePoints, keeper: match.p2.lifePoints, hand: match.p1.hand.length };
    applyKeeperModifiers(match, { reserve: 2, pressure: 1, insight: 1, vanguard: 1 });
    assert.equal(match.p1.lifePoints, before.life + 2_000);
    assert.equal(match.p2.lifePoints, before.keeper - 1_000);
    assert.equal(match.p1.hand.length, before.hand + 2, "Foresight and Vanguard each add a card");
    const strongest = Math.max(...deck.map((id) => { const card = getChronicleCard(id); return card?.cardClass === "monster" ? card.attack : -1; }));
    assert.ok(match.p1.hand.some((id) => { const card = getChronicleCard(id); return card?.cardClass === "monster" && card.attack === strongest; }));
    assert.match(match.log.join(" "), /Deep Reserve/);
});
