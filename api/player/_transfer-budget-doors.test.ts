process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'transfer-budget-doors-test-secret-32-bytes';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The rolling 24h send budget, driven through the three doors that share it:
 * /api/player/trade and the clan and village treasury transfers.
 *
 * A send CHECKS the ledger and only CHARGES it once the transfer has
 * committed, so a refusal never eats budget. That is only a limit if two sends
 * from one sender cannot both pass the same check. The treasury doors checked
 * before their settlement, holding no lock, and charged after it, so a burst of
 * simultaneous gifts all read the same empty ledger and every one of them was
 * paid. The per-call cap was the only thing left standing.
 *
 * Each door now holds the sender's budget gate from before its check until
 * after its charge. These tests fire real concurrent requests at the mounted
 * handlers and count what moved.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let budget: typeof import('./_transfer-budget.js');
let planTreasuryGift: typeof import('../_treasury-gift-tax.js').planTreasuryGift;
let getDurableSettlement: typeof import('../_durable-settlement.js').getDurableSettlement;
let settlementTransactionId: typeof import('../_durable-settlement.js').settlementTransactionId;
let PET_BREEDING_MIGRATION_VERSION: number;
let clanTransfer: Handler;
let villageTransfer: Handler;
let tradeHandler: Handler;

const MEMBER = 'budgetmember';        // in the officer's clan AND village
const VILLAGER = 'budgetvillager';    // in the officer's village only
const TRADE_PARTNER = 'budgetpartner'; // a trade recipient who is neither
const CLAN = 'Ashwind';
const CLAN_KEY = 'save:clan-ashwind';
const VILLAGE = 'Leaf';
const VILLAGE_KEY = 'game:village-state:leaf';
const KAGE_KEY = 'village:kage:leaf';
const TREASURY = 10_000_000;
const GIFT = 200_000; // the per-call cap, so the largest single gift

// A fresh sender per test. The in-process rate limiter cannot be wiped between
// tests, and 30 gifts a minute per sender is the ceiling for the whole file.
let officerSeq = 0;
let officer = '';
let ipSeq = 0;
let requestSeq = 0;

function limit(): number {
    return budget.TRUSTED_OUTBOUND.ryo;
}

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function call(handler: Handler, body: Json): Promise<Out> {
    // A distinct address per request keeps the per-IP rate-limit backstop out
    // of the picture; only the per-sender budget is under test.
    ipSeq += 1;
    const ip = `10.61.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': officer, 'x-player-token': issuePlayerToken(officer), 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

function nextRequestId(): string {
    requestSeq += 1;
    return `budget-door-${officer}-${requestSeq}`;
}

type Door = {
    name: string;
    handler: () => Handler;
    operationType: string;
    sourceKey: string;
    body: (extra?: Json) => Json;
    /** Arrange for the next gift to fail a check that runs before the budget's. */
    refuseForAnotherReason: () => Promise<{ status: number; error: RegExp }>;
};

const DOORS: Door[] = [
    {
        name: 'clan treasury',
        handler: () => clanTransfer,
        operationType: 'clan-treasury-transfer',
        sourceKey: CLAN_KEY,
        // Every gift carries its own requestId. Without one the settlement key
        // is a content fingerprint, and identical gifts would REPLAY rather
        // than race, which is a different path.
        body: (extra = {}) => ({ clanName: CLAN, recipientName: MEMBER, currency: 'ryo', amount: GIFT, requestId: nextRequestId(), ...extra }),
        refuseForAnotherReason: async () => {
            const clan = await kv.get<Json>(CLAN_KEY);
            await kv.set(CLAN_KEY, { ...clan, treasury: { ryo: GIFT - 1 } });
            return { status: 400, error: /Insufficient treasury ryo/ };
        },
    },
    {
        name: 'village treasury',
        handler: () => villageTransfer,
        operationType: 'village-treasury-transfer',
        sourceKey: VILLAGE_KEY,
        body: (extra = {}) => ({ village: VILLAGE, recipientName: MEMBER, currency: 'ryo', amount: GIFT, requestId: nextRequestId(), ...extra }),
        refuseForAnotherReason: async () => {
            await kv.set(VILLAGE_KEY, { treasury: { ryo: GIFT - 1 } });
            return { status: 400, error: /Insufficient treasury ryo/ };
        },
    },
];

async function spent(): Promise<number> {
    return (await budget.checkOutboundBudget(officer, 'ryo', 1, 'trusted')).spent;
}

async function treasuryRyo(key: string): Promise<number> {
    return Number((await kv.get<{ treasury?: { ryo?: number } }>(key))?.treasury?.ryo ?? 0);
}

async function ryoOf(slug: string): Promise<number> {
    return Number((await kv.get<{ character?: { ryo?: number } }>(`save:${slug}`))?.character?.ryo ?? 0);
}

function credited(gifts: number): number {
    return gifts * planTreasuryGift('ryo', GIFT).credit;
}

function isBudgetRefusal(out: Out): boolean {
    return out.statusCode === 429 && out.body?.reason === 'transfer-budget';
}

function summary(results: Out[]): string {
    return JSON.stringify(results.map((r) => ({ status: r.statusCode, error: r.body?.error, reason: r.body?.reason })));
}

async function seedWorld(sender: string): Promise<void> {
    for (const key of await kv.keys('*')) await kv.del(key);
    officer = sender;
    const character = (name: string, extra: Json) => ({
        name, level: 20, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, ...extra,
    });
    // The officer founded the clan AND is the seated Kage, so one sender can
    // reach all three doors. Level 20 with no createdAt is the trusted tier.
    await kv.set(`save:${officer}`, { _saveVersion: 1, character: character(officer, { ryo: TREASURY, clan: CLAN, village: VILLAGE }) });
    await kv.set(`save:${MEMBER}`, { _saveVersion: 1, character: character(MEMBER, { ryo: 0, clan: CLAN, village: VILLAGE }) });
    await kv.set(`save:${VILLAGER}`, { _saveVersion: 1, character: character(VILLAGER, { ryo: 0, village: VILLAGE }) });
    await kv.set(`save:${TRADE_PARTNER}`, { _saveVersion: 1, character: character(TRADE_PARTNER, { ryo: 0 }) });
    await kv.set(CLAN_KEY, {
        founderName: officer,
        members: [{ name: officer, isFounder: true }, { name: MEMBER }],
        treasury: { ryo: TREASURY },
    });
    await kv.set(VILLAGE_KEY, { treasury: { ryo: TREASURY } });
    await kv.set(KAGE_KEY, { kageSystemUnlocked: true, seatedKage: officer });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    budget = await import('./_transfer-budget.js');
    ({ planTreasuryGift } = await import('../_treasury-gift-tax.js'));
    ({ getDurableSettlement, settlementTransactionId } = await import('../_durable-settlement.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    clanTransfer = (await import('../clan/treasury/transfer.js')).default as unknown as Handler;
    villageTransfer = (await import('../village/treasury/transfer.js')).default as unknown as Handler;
    tradeHandler = (await import('./trade.js')).default as unknown as Handler;

    // One send through each door before any test runs. The save write imports
    // several modules lazily, and on a cold transpile cache the first holder of
    // the gate can spend seconds loading them while the rest of a burst burns
    // its lock retries. The concurrency tests are about the budget, not module
    // load time.
    await seedWorld('budgetwarmup');
    for (const [handler, body] of [
        [clanTransfer, DOORS[0].body()],
        [villageTransfer, DOORS[1].body()],
        [tradeHandler, { playerName: officer, toPlayer: TRADE_PARTNER, currency: 'ryo', amount: 1_000, nonce: 'budget-door-warmup' }],
    ] as const) {
        const out = await call(handler, body);
        assert.equal(out.statusCode, 200, `warm-up send failed: ${JSON.stringify(out.body)}`);
    }
});

beforeEach(async () => {
    officerSeq += 1;
    await seedWorld(`budgetofficer${officerSeq}`);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

for (const door of DOORS) {
    describe(`the ${door.name} door shares the sender's send budget`, { concurrency: false }, () => {
        it('lets through only the gifts that fit when they all arrive at once', async () => {
            // Six cap-sized gifts are 1,200,000 against a 1,000,000 budget.
            // Before the gate, all six read the same empty ledger and all six
            // were paid.
            const fits = Math.floor(limit() / GIFT);
            const results = await Promise.all(Array.from({ length: fits + 1 }, () => call(door.handler(), door.body())));

            const sent = results.filter((r) => r.statusCode === 200);
            assert.equal(sent.length, fits, `exactly the in-budget gifts go through: ${summary(results)}`);
            for (const refused of results.filter((r) => r.statusCode !== 200)) {
                assert.ok(isBudgetRefusal(refused), `the rest are refused by the budget, not by anything else: ${summary(results)}`);
            }
            assert.equal(await spent(), fits * GIFT);
            assert.ok(await spent() <= limit(), 'the ledger never passes the ceiling');
            assert.equal(await treasuryRyo(door.sourceKey), TREASURY - fits * GIFT, 'the treasury paid only for what was sent');
            assert.equal(await ryoOf(MEMBER), credited(fits));
        });

        it('charges nothing for a gift the budget refuses, and moves nothing', async () => {
            await budget.chargeOutboundBudget(officer, 'ryo', limit() - 100_000);

            const refused = await call(door.handler(), door.body());
            assert.ok(isBudgetRefusal(refused), JSON.stringify(refused.body));
            assert.match(String(refused.body?.error), /100,000 more ryo/, 'the refusal still says how much is left');
            assert.equal(refused.body?.remaining, 100_000);
            assert.equal(refused.body?.limit, limit());
            assert.equal(await spent(), limit() - 100_000, 'the refused gift was not charged');
            assert.equal(await treasuryRyo(door.sourceKey), TREASURY);
            assert.equal(await ryoOf(MEMBER), 0);

            // The 100,000 it left is still there to spend.
            const fits = await call(door.handler(), door.body({ amount: 100_000 }));
            assert.equal(fits.statusCode, 200, JSON.stringify(fits.body));
            assert.equal(await spent(), limit());
        });

        it('lets the refused gift through as a retry once the budget frees up', async () => {
            // The refusal now happens INSIDE the settlement, so it leaves a
            // journal entry. That entry must be cancelled, not terminal: the
            // treasury clients send no requestId, so the same gift of the same
            // amount comes back under the same key.
            await budget.chargeOutboundBudget(officer, 'ryo', limit());
            const body = door.body();
            assert.ok(isBudgetRefusal(await call(door.handler(), body)));
            const journal = await getDurableSettlement(settlementTransactionId(door.operationType, String(body.requestId)), { kv });
            assert.equal(journal?.state, 'cancelled');

            // Empty the ledger, as 24 hours passing would.
            await kv.del(budget.transferBudgetKey(officer, 'ryo'));
            const retried = await call(door.handler(), body);
            assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
            assert.equal(await spent(), GIFT);
            assert.equal(await ryoOf(MEMBER), credited(1));
        });

        it('charges nothing for a gift refused for another reason', async () => {
            const expected = await door.refuseForAnotherReason();
            const refused = await call(door.handler(), door.body());
            assert.equal(refused.statusCode, expected.status, JSON.stringify(refused.body));
            assert.match(String(refused.body?.error), expected.error);
            assert.equal(await spent(), 0);
        });

        it('charges nothing when the transfer fails after passing the check, and charges once when it completes', async () => {
            // The check now passes INSIDE the settlement, before the debit, so
            // a write failure after it is exactly the case where a check that
            // reserved budget would leak it.
            const originalSet = kv.set.bind(kv);
            let failSource = true;
            kv.set = async (key, value, options) => {
                if (failSource && key === door.sourceKey) { failSource = false; throw new Error('injected treasury write failure'); }
                return originalSet(key, value, options);
            };
            const body = door.body();
            try {
                assert.equal((await call(door.handler(), body)).statusCode, 500);
            } finally {
                kv.set = originalSet;
            }
            assert.equal(await spent(), 0, 'a failed gift is not charged');
            assert.equal(await treasuryRyo(door.sourceKey), TREASURY, 'and moved nothing');

            assert.equal((await call(door.handler(), body)).statusCode, 200);
            assert.equal(await spent(), GIFT, 'the gift that went through is charged exactly once');
        });

        it('does not charge a replay of a gift that already went through', async () => {
            const body = door.body();
            assert.equal((await call(door.handler(), body)).statusCode, 200);
            assert.equal((await call(door.handler(), body)).statusCode, 200);
            assert.equal(await spent(), GIFT);
            assert.equal(await treasuryRyo(door.sourceKey), TREASURY - GIFT);
        });

        it('finishes a debited gift on retry even if the budget filled up in between', async () => {
            // The first attempt passed the check and debited the treasury, then
            // failed to credit the member. Its retry RESUMES that settlement,
            // and the saga skips validateRecipient on a resume, so the budget
            // check is skipped too. That is deliberate. The gift was checked
            // when it was debited, and refusing it now would leave the ryo
            // taken from the treasury and never delivered.
            const originalCompareSet = kv.compareSet.bind(kv);
            let failCredit = true;
            kv.compareSet = async (key, expected, value, options) => {
                if (failCredit && key === `save:${MEMBER}`) throw new Error('injected recipient write failure');
                return originalCompareSet(key, expected, value, options);
            };
            const body = door.body();
            try {
                assert.equal((await call(door.handler(), body)).statusCode, 500);
                assert.equal(await treasuryRyo(door.sourceKey), TREASURY - GIFT, 'the debit committed');
                assert.equal(await spent(), 0, 'nothing is charged for a gift that has not arrived');

                await budget.chargeOutboundBudget(officer, 'ryo', limit());
                failCredit = false;
                const resumed = await call(door.handler(), body);
                assert.equal(resumed.statusCode, 200, JSON.stringify(resumed.body));
            } finally {
                kv.compareSet = originalCompareSet;
            }
            assert.equal(await ryoOf(MEMBER), credited(1), 'the member received it');
            assert.equal(await treasuryRyo(door.sourceKey), TREASURY - GIFT, 'debited once');
            assert.equal(await spent(), limit() + GIFT, 'and it is charged when it lands');
        });
    });
}

describe('one sender across every send door', { concurrency: false }, () => {
    it('serialises a clan gift and a village gift on the same budget', async () => {
        // Room for exactly one more cap-sized gift. The two gifts lock
        // different treasury rows and go to different players, so they share
        // no row lock and only the gate stands between them. Serialising on
        // the treasury row alone would let both read 800,000 and both go
        // through.
        await budget.chargeOutboundBudget(officer, 'ryo', limit() - GIFT);
        const results = await Promise.all([
            call(clanTransfer, DOORS[0].body()),
            call(villageTransfer, DOORS[1].body({ recipientName: VILLAGER })),
        ]);

        const sent = results.filter((r) => r.statusCode === 200);
        assert.equal(sent.length, 1, `exactly one of the two gifts fits: ${summary(results)}`);
        for (const refused of results.filter((r) => r.statusCode !== 200)) {
            assert.ok(isBudgetRefusal(refused), `the other is a budget refusal: ${summary(results)}`);
        }
        assert.equal(await spent(), limit());
        const moved = (TREASURY - await treasuryRyo(CLAN_KEY)) + (TREASURY - await treasuryRyo(VILLAGE_KEY));
        assert.equal(moved, GIFT, 'only one treasury paid out');
    });

    it('serialises a trade with both treasury gifts on the same budget', async () => {
        // /api/player/trade serialises one sender's trades on their save lock,
        // which no treasury gift takes. The trade goes to a third player, so
        // it shares no lock at all with the gifts, and without the gate it and
        // a gift would both read 800,000 and both go through.
        await budget.chargeOutboundBudget(officer, 'ryo', limit() - GIFT);
        requestSeq += 1;
        const results = await Promise.all([
            call(tradeHandler, { playerName: officer, toPlayer: TRADE_PARTNER, currency: 'ryo', amount: GIFT, nonce: `budget-door-trade-${requestSeq}` }),
            call(clanTransfer, DOORS[0].body()),
            call(villageTransfer, DOORS[1].body({ recipientName: VILLAGER })),
        ]);

        const sent = results.filter((r) => r.statusCode === 200);
        assert.equal(sent.length, 1, `exactly one of the three sends fits: ${summary(results)}`);
        for (const refused of results.filter((r) => r.statusCode !== 200)) {
            assert.ok(isBudgetRefusal(refused), `the other two are budget refusals: ${summary(results)}`);
        }
        assert.equal(await spent(), limit());
        const moved = (TREASURY - await treasuryRyo(CLAN_KEY))
            + (TREASURY - await treasuryRyo(VILLAGE_KEY))
            + (TREASURY - await ryoOf(officer));
        assert.equal(moved, GIFT, 'only one send left any pocket');
    });
});
