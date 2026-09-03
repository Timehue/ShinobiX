import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';

/*
 * Exactly-once for the pet-arena ryo faucet.
 *
 * Both paid pet modes — the legacy coliseum (pet/battle-result.ts) and Showdown
 * (pet/showdown.ts) — dedupe payouts against the SAME character array,
 * redeemedPetBattleTokens. An array is a rolling window: it is truncated before
 * every append, so a busy player evicts their own older receipts. A receipt that
 * gets evicted while the thing it de-duplicates is still redeemable is not a
 * receipt at all — the same fight can be cashed again.
 *
 * The guard is a pair. The array is written in the same save write as the ryo,
 * so it is exact but short-lived. The durable `pet:battle-paid:` key is not
 * touched by other battles, so it outlives the eviction; its TTL is what must
 * cover the redeemable window (a 45-minute Showdown session, a 15-minute battle
 * token). Behaviour below, source shape after it — the ordering guarantees
 * (check before paying, place after paying, lease stamped only on the finishing
 * turn) are not visible to a behavioural test without standing up the whole
 * endpoint, and they are exactly what a careless refactor drops.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), 'api', 'pet', rel), 'utf8');
const showdownSrc = read('showdown.ts');
const coliseumSrc = read('battle-result.ts');

const contractSrc = readFileSync(
    join(process.cwd(), 'shared', 'pet-showdown-contract.ts'),
    'utf8',
);

/**
 * Read a compile-time constant's VALUE out of a handler.
 *
 * Accepts either a literal (`const N = 100;`) or an alias of a shared-contract
 * constant (`const N = SHOWDOWN_DAILY_WIN_CAP;`), resolving the alias to its
 * literal. The point of this helper is that the number is fixed at build time
 * and knowable here — not that it is spelled out twice. The daily cap is now
 * defined once in the contract precisely so the two handlers and the lobby copy
 * cannot drift; following the alias keeps this test honest about the real value
 * instead of forcing the duplication back.
 */
function sourceConstant(src: string, name: string): number {
    const literal = new RegExp(`const ${name} = ([0-9_ *]+);`).exec(src);
    if (literal) {
        return literal[1].split('*').reduce((acc, part) => acc * Number(part.replace(/_/g, '').trim()), 1);
    }
    const alias = new RegExp(`const ${name} = ([A-Z_][A-Z0-9_]*);`).exec(src);
    assert.ok(alias, `${name} must be a compile-time constant (a literal, or an alias of one)`);
    const shared = new RegExp(`export const ${alias[1]} = ([0-9_ *]+);`).exec(contractSrc);
    assert.ok(shared, `${name} aliases ${alias[1]}, which must be a numeric constant in the shared contract`);
    return shared[1].split('*').reduce((acc, part) => acc * Number(part.replace(/_/g, '').trim()), 1);
}

// ── Behaviour ───────────────────────────────────────────────────────────────

const RECEIPT_HISTORY = Math.max(64, sourceConstant(showdownSrc, 'DAILY_ARENA_WIN_CAP'));

/** The settle path both handlers run, reduced to its idempotency decision. */
async function settleWin(
    kv: ReturnType<typeof _makeMemoryKv>,
    player: string,
    receipt: string,
    opts: { durableReceipt: boolean },
): Promise<number> {
    const saveKey = `save:${player}`;
    const paidKey = `pet:battle-paid:${player}:${receipt}`;
    const record = await kv.get<Record<string, unknown>>(saveKey);
    const char = record?.character as Record<string, unknown>;
    const receipts = (char.redeemedPetBattleTokens as string[]).slice(-(RECEIPT_HISTORY - 1));
    if (receipts.includes(receipt)) return 0;
    if (opts.durableReceipt && await kv.get(paidKey)) return 0;
    const reward = 60;
    await kv.set(saveKey, {
        ...record,
        character: {
            ...char,
            redeemedPetBattleTokens: [...receipts, receipt],
            ryo: Number(char.ryo ?? 0) + reward,
        },
    });
    if (opts.durableReceipt) await kv.set(paidKey, { at: Date.now() }, { nx: true, ex: 24 * 60 * 60 });
    return reward;
}

/** Report `count` unrelated battles, each appending its own receipt. */
async function churnReceipts(kv: ReturnType<typeof _makeMemoryKv>, player: string, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
        await settleWin(kv, player, `other-${i}`, { durableReceipt: true });
    }
}

async function freshSave(player: string) {
    const kv = _makeMemoryKv();
    await kv.set(`save:${player}`, { character: { ryo: 0, redeemedPetBattleTokens: [] } });
    return kv;
}

describe('pet battle payout is exactly-once across receipt-array eviction', () => {
    it('pays a win once no matter how often it is re-presented immediately', async () => {
        const kv = await freshSave('Kaito');
        assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: true }), 60);
        for (let i = 0; i < 5; i += 1) {
            assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: true }), 0, 'replay pays nothing');
        }
        const save = await kv.get<Record<string, any>>('save:Kaito');
        assert.equal(save?.character.ryo, 60);
    });

    it('still pays it once after enough later battles to flush the array receipt', async () => {
        // The attack: settle a fight, keep its session/token alive, then report
        // a full window of other battles so the array truncation drops the
        // receipt, and cash the original fight again.
        const kv = await freshSave('Kaito');
        assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: true }), 60);
        await churnReceipts(kv, 'Kaito', RECEIPT_HISTORY + 10);

        const save = await kv.get<Record<string, any>>('save:Kaito');
        const stored = save?.character.redeemedPetBattleTokens as string[];
        assert.equal(stored.includes('sd:abc'), false, 'the array receipt is gone — this is the premise, not the bug');

        assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: true }), 0, 'the durable receipt still blocks it');
    });

    it('WOULD pay it twice on the array alone — which is why the durable receipt exists', async () => {
        // Same scenario with only the rolling array guarding it. If this ever
        // stops double-paying, the premise above has changed and the pairing can
        // be revisited; until then it is the reason the pair is not redundant.
        const kv = await freshSave('Kaito');
        assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: false }), 60);
        await churnReceipts(kv, 'Kaito', RECEIPT_HISTORY + 10);
        assert.equal(await settleWin(kv, 'Kaito', 'sd:abc', { durableReceipt: false }), 60, 'array-only dedupe is flushable');
    });

    it('keeps the array window at least as wide as the daily cap it records', async () => {
        // A window narrower than the cap cannot even hold one day of paid wins,
        // so honest play alone walks receipts out of it.
        for (const [label, src] of [['showdown.ts', showdownSrc], ['battle-result.ts', coliseumSrc]] as const) {
            assert.match(
                src,
                /const RECEIPT_HISTORY = Math\.max\(\d+, DAILY_ARENA_WIN_CAP\)/,
                `${label} must derive its receipt window from the cap, so raising the cap widens it`,
            );
            assert.doesNotMatch(src, /\.slice\(-\d+\)/, `${label} must not truncate receipts at a hardcoded width`);
            assert.ok(
                RECEIPT_HISTORY >= sourceConstant(src, 'DAILY_ARENA_WIN_CAP'),
                `${label} window is narrower than its own daily cap`,
            );
        }
    });
});

// ── Source shape ────────────────────────────────────────────────────────────

const indexOfOrFail = (src: string, label: string, needle: string | RegExp): number => {
    const idx = typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);
    assert.ok(idx >= 0, `${label} must contain ${needle}`);
    return idx;
};

describe('both handlers wire the durable receipt in the safe order', () => {
    for (const [label, src, payingWrite] of [
        ['showdown.ts', showdownSrc, 'await writeSaveProjected(saveKey, updated, record);'],
        ['battle-result.ts', coliseumSrc, 'await writeSaveProjected(saveKey, updated, record);'],
    ] as const) {
        it(`${label} checks the durable receipt before paying`, () => {
            const check = indexOfOrFail(
                src,
                label,
                /await kv\.get(?:<[^>]+>)?\(\s*(?:paidReceiptKey\(|paidKey)/,
            );
            const write = src.lastIndexOf(payingWrite);
            assert.ok(check < write, 'the durable receipt must be read before the paying write');
        });

        it(`${label} places the durable receipt only after the paying write`, () => {
            // Claiming it first would let a failed save write swallow a reward
            // the player earned, with no way to retry.
            const write = src.lastIndexOf(payingWrite);
            const relativePlace = src.slice(write).search(/kv\.set\(\s*paidReceiptKey\(|kv\.set\(paidKey,/);
            const place = relativePlace < 0 ? -1 : write + relativePlace;
            assert.ok(place > write, `${label} must place the durable receipt after the paying write`);
            assert.match(src.slice(place, place + 220), /nx: true/, 'placed NX so a retry cannot restart its TTL');
            assert.match(src.slice(place, place + 220), /ex: PAID_RECEIPT_TTL_SECONDS/, 'placed with the durable TTL');
        });
    }

    it('the durable receipt outlives every artifact that can still be presented for payment', () => {
        // A Showdown session leases SESSION_TTL_SECONDS and a coliseum battle
        // token 15 minutes. If the receipt expires first, the artifact outlives
        // its own proof of payment and the fight can be cashed again.
        const sessionTtl = sourceConstant(showdownSrc, 'SESSION_TTL_SECONDS');
        for (const [label, src] of [['showdown.ts', showdownSrc], ['battle-result.ts', coliseumSrc]] as const) {
            const receiptTtl = sourceConstant(src, 'PAID_RECEIPT_TTL_SECONDS');
            assert.ok(receiptTtl > sessionTtl, `${label}: receipt TTL ${receiptTtl}s must exceed the ${sessionTtl}s session lease`);
        }
    });

    it('a settled Showdown session cannot be kept warm past its own lease', () => {
        // Re-stamping the TTL on every re-post meant a paid session never
        // expired as long as someone kept posting to it — an indefinitely
        // redeemable artifact, which no finite receipt TTL can cover.
        assert.match(
            showdownSrc,
            /if \(!replayed\) await kv\.set\(key, session, \{ ex: SESSION_TTL_SECONDS \}\)/,
            'only the turn that FINISHES the fight may stamp the retention lease',
        );
        // Matched without pinning the trailing fields: the turn result now also
        // carries the `bindings` record, and will grow again. What must not
        // drift is that a re-post returns NO new events and is flagged replayed.
        assert.match(showdownSrc, /return \{ session, events: \[\], replayed: true\b/, 're-posts must be flagged as replays');
    });
});

describe('every showdown action is rate limited', () => {
    // state and forfeit shipped without limits while start and turn had them,
    // so an unauthenticated-shaped loop could hammer the session store for free.
    // EVERY action belongs in this list — the two session-minting entries that
    // landed after it (arena, encounter) are the expensive ones, since each
    // writes a session and the authored entry also reads the admin content
    // catalog.
    const ACTIONS = ['start', 'arena', 'encounter', 'turn', 'state', 'forfeit'] as const;

    // Matched on each branch's full opening line, not a bare `action === 'x'`.
    // The Hollow Gate admission guard tests `action === 'arena'` as part of a
    // COMPOUND condition earlier in the file, so the loose needle anchored the
    // arena branch to that guard — a short rejection that touches no KV — and
    // every assertion below then read the wrong block.
    const branchFor = (action: string): string => {
        const start = indexOfOrFail(showdownSrc, 'showdown.ts', `if (action === '${action}') {`);
        const nextStarts = ACTIONS
            .map((other) => showdownSrc.indexOf(`if (action === '${other}') {`, start + 1))
            .filter((idx) => idx > start);
        return showdownSrc.slice(start, nextStarts.length ? Math.min(...nextStarts) : showdownSrc.length);
    };

    for (const action of ACTIONS) {
        it(`${action} enforces a KV rate limit`, () => {
            assert.match(
                branchFor(action),
                /enforceRateLimitKv\(req, res, 'pet-showdown-[a-z]+', \d+, \d+/,
                `the ${action} branch must throttle before it touches KV`,
            );
        });
    }

    it('each action spends its own bucket', () => {
        // Sharing a bucket would let cheap polling starve the budget the
        // expensive action needs, and would hide which action is being abused.
        const buckets = ACTIONS.map((action) => {
            const match = /enforceRateLimitKv\(req, res, '(pet-showdown-[a-z]+)'/.exec(branchFor(action));
            return match?.[1];
        });
        assert.equal(new Set(buckets).size, ACTIONS.length, `buckets must be distinct: ${buckets.join(', ')}`);
    });
});
