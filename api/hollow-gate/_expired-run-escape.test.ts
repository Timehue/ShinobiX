import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleSaveRecord, hollowGateRunTokenOf } from '../_elapsed-state.js';
import { mergePreservingImages } from '../_utils.js';
import { hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES } from './_run-token.js';
import { isHollowGateRunExpiredMessage, clearHollowGateRunLocal, reportHollowGateRunError } from '../../shinobij.client/src/lib/hollow-gate-server.js';
import type { Character } from '../../shinobij.client/src/types/character.js';

/*
 * An EXPIRED Hollow Gate run used to trap the player permanently (reproduced live
 * 2026-07-17; the owner's account needed a manual Postgres edit to escape).
 * The trap has three interlocking parts, and each gets a test here:
 *   1. The run persists on the SAVE, so clearing localStorage does nothing.
 *   2. The shrine is deliberately no-retreat, so load restores you back INTO it.
 *   3. Every action 409s once the server run token lapses, and dismissing the
 *      resulting notice did not clear the run — an infinite loop.
 */

const RUN = { floor: 3, keys: 1, runToken: 'live-token', entryCurrencies: { hollowShards: 70 } };
const saveWithRun = (run: unknown = RUN) => ({ character: { name: 'Rill', hollowGateRun: run }, _saveVersion: 4 });

// ── The pure self-heal ────────────────────────────────────────────────────────

test('expired run is cleared from the save so the player is not restored into the gate', () => {
    const out = settleSaveRecord(saveWithRun(), { hollowGateRunExpired: true });
    assert.equal(out.hollowGateRunCleared, true, 'the clear is reported to the caller');
    assert.equal(out.changed, true, 'a cleared run marks the record dirty so it persists');
    assert.equal((out.record.character as Record<string, unknown>).hollowGateRun, undefined, 'the dead run is gone');
});

test('a LIVE run is never cleared — only an expired token frees the save', () => {
    const out = settleSaveRecord(saveWithRun(), { hollowGateRunExpired: false });
    assert.equal(out.hollowGateRunCleared, false, 'a live dive is left completely alone');
    assert.deepEqual((out.record.character as Record<string, unknown>).hollowGateRun, RUN, 'run untouched');
});

test('the expiry flag defaults off, so the foreign-save readers (roster/pvp) never clear a run', () => {
    // api/player/roster.ts + api/pvp/session.ts call settleSaveRecord with no expiry
    // probe (it would cost a KV read per player). They must never drop a run.
    const out = settleSaveRecord(saveWithRun(), {});
    assert.equal(out.hollowGateRunCleared, false);
    assert.deepEqual((out.record.character as Record<string, unknown>).hollowGateRun, RUN);
});

test('clearing does not mutate the caller-supplied record', () => {
    const input = saveWithRun();
    settleSaveRecord(input, { hollowGateRunExpired: true });
    assert.deepEqual(input.character.hollowGateRun, RUN, 'the input save is untouched (copy-on-write)');
});

test('a save with no run at all is a no-op (not a spurious dirty write)', () => {
    const out = settleSaveRecord({ character: { name: 'Rill' }, _saveVersion: 1 }, { hollowGateRunExpired: true });
    assert.equal(out.hollowGateRunCleared, false);
    assert.equal(out.changed, false, 'nothing to clear -> no write amplification');
});

// ── The mergePreservingImages trap (the whole reason this uses `undefined`) ─────

test('REGRESSION: the cleared run survives the mergePreservingImages persist path', () => {
    // settleSaveRecordForRead persists via mergePreservingImages(versioned, fresh),
    // which SEEDS from the stored record and only overrides keys PRESENT on the
    // incoming one. This is the exact trap that resurrects a `delete`d field.
    const fresh = saveWithRun();
    const cleared = settleSaveRecord(saveWithRun(), { hollowGateRunExpired: true }).record;
    const merged = mergePreservingImages(cleared, fresh) as { character: Record<string, unknown> };
    assert.equal(merged.character.hollowGateRun, undefined, 'the run stays cleared through the merge');
    // And the write actually drops it: kv.set serialises to JSON, which strips undefined.
    assert.equal('hollowGateRun' in JSON.parse(JSON.stringify(merged)).character, false, 'absent from the stored JSON');
});

test('REGRESSION: `delete` would resurrect the run — proving why the fix sets `undefined`', () => {
    // Pins the trap itself (main @3a2e1c64, the pet-training claim-persist fix). If a
    // future refactor "tidies" the self-heal into a delete, the test above starts
    // failing and this one explains why.
    const fresh = saveWithRun();
    const viaDelete = saveWithRun() as { character: Record<string, unknown> };
    delete viaDelete.character.hollowGateRun;
    const merged = mergePreservingImages(viaDelete, fresh) as { character: Record<string, unknown> };
    assert.deepEqual(merged.character.hollowGateRun, RUN, 'a deleted key IS resurrected from the stored save');
});

test('the cleared run survives alongside a same-pass vitals regen', () => {
    // canRegenVitals() blocks regen while a run is open, so clearing the run unblocks
    // regen in the SAME settle pass — the vitals branch re-clones the character and
    // must not lose the clear.
    const record = {
        character: { name: 'Rill', hollowGateRun: RUN, hp: 1, maxHp: 500, chakra: 1, maxChakra: 500, stamina: 1, maxStamina: 500 },
        _saveAt: 1_000_000,
    };
    const out = settleSaveRecord(record, { hollowGateRunExpired: true, now: 1_060_000 });
    const char = out.record.character as Record<string, unknown>;
    assert.equal(char.hollowGateRun, undefined, 'clear survives the vitals re-clone');
    assert.ok((char.hp as number) > 1, 'regen resumes once the dead run is gone');
});

test('END-TO-END: expired run -> healed save -> the player is NOT restored into the gate', () => {
    // On load the client re-enters the shrine iff the SAVED run exists and is
    // unfinished (App.tsx: `inHollowGateRun ? "hollowGateShrine" : "village"`, and
    // the shrine target bounces to village when the run is missing). Model that
    // predicate against the save the server actually hands back after the heal.
    const restoresIntoGate = (save: { character: Record<string, unknown> }) => {
        const run = save.character.hollowGateRun as { completed?: boolean } | null | undefined;
        return Boolean(run && !run.completed);
    };

    const trapped = saveWithRun();
    assert.equal(restoresIntoGate(trapped), true, 'the bug: a stale run drags the player back in');

    // What api/save/[name].ts GET now returns: settled, merged, and JSON round-tripped.
    const healed = JSON.parse(JSON.stringify(mergePreservingImages(
        settleSaveRecord(saveWithRun(), { hollowGateRunExpired: true }).record,
        trapped,
    )));
    assert.equal(restoresIntoGate(healed), false, 'freed — the next load lands in the village, not a dead gate');
});

// ── What the expiry probe will and won't look up ──────────────────────────────

test('only a TOKENED run is probed — a legacy token-less run is never auto-cleared', () => {
    // hollowGateRunExpiredFor keys the KV probe on this. No token means no way to
    // ask whether the run is live, so it must not be treated as expired. It also
    // keeps the probe off the hot path for every player who is not mid-dive.
    assert.equal(hollowGateRunTokenOf(saveWithRun()), 'live-token', 'tokened dive is probed');
    assert.equal(hollowGateRunTokenOf(saveWithRun({ floor: 2, keys: 0 })), null, 'legacy run: left alone');
    assert.equal(hollowGateRunTokenOf({ character: { name: 'Rill' } }), null, 'no run: no KV read');
    assert.equal(hollowGateRunTokenOf({}), null, 'no character: no KV read');
    assert.equal(hollowGateRunTokenOf(saveWithRun({ ...RUN, runToken: '' })), null, 'blank token is not a token');
});

// ── Key + message contract (server <-> client drift guards) ────────────────────

test('hollowGateRunKey pins the exact KV key every endpoint and the self-heal share', () => {
    assert.equal(hollowGateRunKey('rill', 'abc123'), 'hg-run:rill:abc123');
});

test('DRIFT: the client matcher recognises every expired message the server can send', () => {
    for (const message of Object.values(HOLLOW_GATE_RUN_EXPIRED_MESSAGES)) {
        assert.equal(isHollowGateRunExpiredMessage(message), true, `client must recognise: ${message}`);
    }
});

test('the matcher does not fire on unrelated run errors (which must stay non-destructive)', () => {
    for (const message of [
        'Not your run.',
        'Finish the active encounter first.',
        'The encounter floor does not match the sealed run.',
        "Berserker's Gamble seals retreat until the final Hollow Hound Alpha falls.",
        'The run is too new to extract.',
        '',
    ]) {
        assert.equal(isHollowGateRunExpiredMessage(message), false, `must NOT treat as expired: ${message}`);
    }
});

// ── The client dismiss path ───────────────────────────────────────────────────

test('clearHollowGateRunLocal uses null (JSON keeps it) — undefined would be stripped and resurrect', () => {
    const cleared = clearHollowGateRunLocal({ name: 'Rill', hollowGateRun: RUN } as unknown as Character);
    assert.equal(cleared.hollowGateRun, null, 'null, not undefined');
    const posted = JSON.parse(JSON.stringify(cleared));
    assert.equal('hollowGateRun' in posted, true, 'survives the autosave payload');
    assert.equal(posted.hollowGateRun, null, 'so the server merge overrides the stored run');
});

test('dismissing an EXPIRED run clears it and frees the player', () => {
    const notices: string[] = [];
    let freed = false;
    const expired = reportHollowGateRunError(
        new Error(HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatStart),
        'fallback',
        () => { freed = true; },
        (m) => notices.push(m),
    );
    assert.equal(expired, true, 'recognised as an expired run');
    assert.equal(freed, true, 'the escape ran — this is the fix for the permanent trap');
    assert.match(notices[0]!, /released its hold/, 'the player is told they are being let out');
});

test('dismissing an ordinary run error does NOT clear the run', () => {
    const notices: string[] = [];
    let freed = false;
    const expired = reportHollowGateRunError(new Error('Not your run.'), 'fallback', () => { freed = true; }, (m) => notices.push(m));
    assert.equal(expired, false);
    assert.equal(freed, false, 'a live run must never be discarded by a transient error');
    assert.deepEqual(notices, ['Not your run.'], 'the original message is surfaced verbatim');
});

test('a non-Error throw (network failure) falls back without discarding a live run', () => {
    let freed = false;
    const expired = reportHollowGateRunError(null, 'The Hollow Gate encounter could not start.', () => { freed = true; }, () => {});
    assert.equal(expired, false);
    assert.equal(freed, false, 'an offline blip must not void the dive');
});
