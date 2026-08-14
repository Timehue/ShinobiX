import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appendWarfrontSettlementReceipt,
    findWarfrontSettlementReceipt,
    findWarfrontSettlementReceiptByReportKey,
    nextWarfrontCoachMasteryReceipt,
    warfrontReceiptResponse,
    WARFRONT_COACH_MASTERY_DAILY_CAP,
    WARFRONT_SETTLEMENT_RECEIPT_RETENTION_MS,
    type WarfrontSettlementReceipt,
} from './battle-result.js';
import {
    WARFRONT_ACTIVE_GRACE_SECONDS,
    WARFRONT_PREPARE_TTL_SECONDS,
    WARFRONT_TOKEN_TTL_SECONDS,
} from './warfront-start.js';
import { WARFRONT_COACH_COMPLETION_DAILY_CAP, warfrontBaseRyoReward } from './_warfront-reward.js';

const receipt: WarfrontSettlementReceipt = {
    battleToken: 'token-123',
    reportKey: '4242:tactical',
    outcome: 'win',
    reward: 500,
    firstWinOfDay: true,
    firstWinBonus: 400,
    capped: false,
    totalPetWins: 9,
    dailyPetWins: 2,
    settledAt: 1_700_000_000_000,
};

test('Warfront settlement receipts require the exact token and report key', () => {
    const character = { warfrontSettlementReceipts: [receipt] };
    assert.deepEqual(findWarfrontSettlementReceipt(character, receipt.battleToken, receipt.reportKey), receipt);
    assert.equal(findWarfrontSettlementReceipt(character, 'different-token', receipt.reportKey), null);
    assert.equal(findWarfrontSettlementReceipt(character, receipt.battleToken, 'different:report'), null);
});

test('a second mint token for the same report replays instead of paying twice', () => {
    const character = { warfrontSettlementReceipts: [receipt] };
    assert.deepEqual(findWarfrontSettlementReceiptByReportKey(character, receipt.reportKey), receipt);
    assert.equal(findWarfrontSettlementReceiptByReportKey(character, 'different:report'), null);

    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-result.ts'), 'utf8');
    const reportDedupe = source.indexOf('findWarfrontSettlementReceiptByReportKey(char, reportKey)');
    const redeemedAppend = source.indexOf('char.redeemedPetBattleTokens =');
    assert.ok(reportDedupe >= 0 && redeemedAppend > reportDedupe, 'report-level dedupe must run before any second token can be redeemed and paid');

    const startSource = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-start.ts'), 'utf8');
    assert.match(startSource, /withKvLock\(authorizationKey[\s\S]*idempotentReplay: true/, 'mint retries must serialize and return the one live token for a report');
    assert.match(startSource, /isRecoverableWarfrontAuthorization\([^)]*playerName, prepareToken\)/,
        'reload recovery must be bound to the original server scouting grant');
    assert.match(startSource, /authorizationResponse\(existingAuthorization, true\)/,
        'recovery must return the originally sealed setup, not trust reconstructed client preferences');
    assert.match(startSource, /kv\.set\(authorizationKey, grant, \{ nx: true/, 'atomic NX must backstop an expired mint-lock lease');
});

test('count churn cannot evict a paid receipt while its token may still be live', () => {
    assert.ok(WARFRONT_SETTLEMENT_RECEIPT_RETENTION_MS > WARFRONT_TOKEN_TTL_SECONDS * 1000);
    const now = Date.now();
    const receipts = Array.from({ length: 200 }, (_, index): WarfrontSettlementReceipt => ({
        ...receipt,
        battleToken: `token${index}`,
        reportKey: `${index}:tactical`,
        settledAt: now - index,
    }));
    const oldestStillLive = receipts[receipts.length - 1];
    assert.deepEqual(
        findWarfrontSettlementReceipt({ warfrontSettlementReceipts: receipts }, oldestStillLive.battleToken, oldestStillLive.reportKey),
        oldestStillLive,
    );
});

test('malformed client-shaped receipt data is never treated as a settlement', () => {
    const forged = { ...receipt, reward: 'lots' };
    assert.equal(findWarfrontSettlementReceipt({ warfrontSettlementReceipts: [forged] }, receipt.battleToken, receipt.reportKey), null);
});

test('Coach mastery is fixed, daily-capped, and durable inside exact-once receipts', () => {
    const day = new Date().toISOString().slice(0, 10);
    let character: Record<string, unknown> = { totalPetWins: 4, dailyPetWins: 1 };
    for (let index = 0; index < WARFRONT_COACH_MASTERY_DAILY_CAP + 1; index += 1) {
        const coachMastery = nextWarfrontCoachMasteryReceipt(character, day, true);
        assert.equal(coachMastery.earned, index < WARFRONT_COACH_MASTERY_DAILY_CAP ? 1 : 0);
        assert.equal(coachMastery.completedToday, Math.min(index + 1, WARFRONT_COACH_MASTERY_DAILY_CAP));
        const baseAmount = warfrontBaseRyoReward(18);
        const amount = coachMastery.earned ? baseAmount : 0;
        character = appendWarfrontSettlementReceipt(character, {
            ...receipt,
            battleToken: `coach-token-${index}`,
            reportKey: `coach-${index}:tactical`,
            outcome: index % 2 === 0 ? 'win' : 'loss',
            reward: amount,
            firstWinOfDay: false,
            firstWinBonus: 0,
            rewardEligible: false,
            coachMastery,
            coachReward: {
                kind: 'coach-completion', currency: 'ryo', day,
                baseAmount, amount,
                completedToday: coachMastery.completedToday,
                dailyCap: WARFRONT_COACH_COMPLETION_DAILY_CAP,
                capped: coachMastery.capped,
            },
            settledAt: Date.now() + index,
        });
    }
    const replay = findWarfrontSettlementReceipt(character, 'coach-token-0', 'coach-0:tactical');
    assert.equal(replay?.coachMastery?.earned, 1, 'the original completion remains durable after later settlements');
    assert.equal(nextWarfrontCoachMasteryReceipt(character, day, true).earned, 0, 'receipt churn cannot exceed the daily cap');
    assert.equal(warfrontBaseRyoReward(1), 20, 'low progression has the fixed economy floor');
    assert.equal(warfrontBaseRyoReward(18), 36, 'Coach receives sealed base reward without a win multiplier');
});

test('forfeit receipts replay as zero-value losses and never masquerade as Coach completion', () => {
    const coachMastery = nextWarfrontCoachMasteryReceipt({}, '2026-08-10', false);
    const forfeited: WarfrontSettlementReceipt = {
        ...receipt,
        outcome: 'loss',
        reward: 0,
        firstWinOfDay: false,
        firstWinBonus: 0,
        rewardEligible: false,
        forfeited: true,
        coachMastery,
    };
    const response = warfrontReceiptResponse(forfeited, { ryo: 100 }, 7) as {
        forfeited?: boolean;
        reason?: string;
        reward: number;
        coachMastery?: { earned: number };
    };
    assert.equal(response.forfeited, true);
    assert.equal(response.reason, 'warfront-forfeit');
    assert.equal(response.reward, 0);
    assert.equal(response.coachMastery?.earned, 0);
});

test('authorization covers a paused regulation match and receipts commit with the save', () => {
    assert.ok(WARFRONT_TOKEN_TTL_SECONDS >= 60 * 60, 'a ten-minute match plus pauses/reconnects needs a safe authorization window');

    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-result.ts'), 'utf8');
    const receiptBuild = source.indexOf('const updatedChar = withWarfrontReceipt');
    const saveCommit = source.indexOf('await writeSaveProjected(saveKey, updated, record)');
    const missingTokenReplay = source.indexOf('findWarfrontSettlementReceipt(settledCharacter, battleToken, reportKey)');
    const missingTokenReportFallback = source.indexOf('findWarfrontSettlementReceiptByReportKey(settledCharacter, reportKey)', missingTokenReplay);
    const ambiguousSpentResponse = source.indexOf("reason: 'invalid-or-spent-pet-battle-token'", missingTokenReplay);

    assert.ok(receiptBuild >= 0 && saveCommit > receiptBuild, 'the payout and its retry receipt must share the committed character write');
    assert.ok(missingTokenReplay >= 0 && ambiguousSpentResponse > missingTokenReplay, 'lost-response retries must consult the durable receipt first');
    assert.ok(missingTokenReportFallback > missingTokenReplay && ambiguousSpentResponse > missingTokenReportFallback, 'a lost report-dedupe response must replay by report key after its alias token is deleted');
    assert.match(source, /tokenData\.mode === 'warfront' && outcome !== tokenData\.authoritativeOutcome/, 'a watched result mismatch must not silently consume an honest Warfront reward');

    const ownership = readFileSync(join(process.cwd(), 'api', 'save', '_state-ownership.ts'), 'utf8');
    assert.match(ownership, /warfrontSettlementReceipts[\s\S]*progression-entitlement-char/, 'generic saves must preserve the server-owned receipt ledger');
    assert.match(ownership, /lastWarfrontFirstWinDate[\s\S]*progression-entitlement-char/, 'generic saves must preserve the durable first-win guard');
});

test('reward seed and rendered rosters come from the server-prepared authorization', () => {
    assert.ok(WARFRONT_PREPARE_TTL_SECONDS >= 24 * 60 * 60);
    const source = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-start.ts'), 'utf8');
    assert.match(source, /action === 'prepare'/);
    assert.match(source, /pet:warfront-prepared:/);
    assert.match(source, /preparedWarfrontResponse\(prepared\)/);
    assert.doesNotMatch(source, /preparedSeed:/, 'the raw seed must stay hidden until squad/setup commitment');
    assert.match(source, /const seed = preparedPreview\.seed[\s\S]*const reportKey = `\$\{seed\}:tactical`/);
    assert.match(source, /blue: grant\.blue[\s\S]*red: grant\.red/, 'the client must render the exact slots used by the authoritative simulation');

    const clientSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'PetArena.tsx'), 'utf8');
    assert.match(clientSource, /const authorizedRed = parseAuthorizedWarfrontSlots\(data\.red\)/,
        'the browser must parse the exact unique server-sealed opponent roster');
    assert.doesNotMatch(clientSource, /seed: contract\.seed/, 'the client cannot submit a pre-commit seed');
});

test('one active server seed is held for the sealed match clock and released only after settlement commit', () => {
    assert.ok(WARFRONT_ACTIVE_GRACE_SECONDS >= 30);
    const startSource = readFileSync(join(process.cwd(), 'api', 'pet', 'warfront-start.ts'), 'utf8');
    const cheapPreparedCheck = startSource.indexOf('const preparedPreview =');
    const expensiveSimulation = startSource.search(/runWarfrontMatch\s*\(\s*blueSlots/);
    const startReservationClaim = startSource.indexOf('kv.set(activeKey, startReservation');
    const activeClaim = startSource.indexOf('kv.set(activeKey, token');
    const authorizationClaim = startSource.indexOf('kv.set(authorizationKey, grant');
    const consumePrepared = startSource.indexOf('await consumePreparedWarfrontGrant(preparedKey', authorizationClaim);
    assert.ok(cheapPreparedCheck >= 0 && expensiveSimulation > cheapPreparedCheck,
        'invalid grants must be rejected before the full deterministic simulation');
    assert.ok(startReservationClaim > cheapPreparedCheck && startReservationClaim < expensiveSimulation,
        'the player-wide single-flight reservation must be held before the expensive simulation');
    assert.ok(activeClaim >= 0 && authorizationClaim > activeClaim && consumePrepared > authorizationClaim,
        'the active lease must be NX-claimed before authorization exposure and seed consumption');
    assert.match(startSource, /result\.ticks \* 1000 \/ WARFRONT_TPS[\s\S]*notBefore/,
        'auto settlement maturity must use the exact sealed sim duration');
    assert.match(startSource, /kv\.delIfEqual\(activeKey, token\)/,
        'failed mint contenders may clear only their own active lease');
    assert.match(startSource, /warfrontAuthorization: grant/,
        'a crash between active-NX and authorization-NX must retain the exact recoverable grant in the token');
    const repairedWinner = startSource.indexOf('winner.token === token');
    const loserActiveDelete = startSource.indexOf('kv.delIfEqual(activeKey, token)', repairedWinner);
    assert.ok(repairedWinner >= 0 && loserActiveDelete > repairedWinner,
        'an original request must preserve a token whose pointer was repaired by its retry');
    assert.match(startSource, /recoverAuthorizationActiveLease[\s\S]*await kv\.delIfEqual\(activeKey, authorization\.token\)/,
        'recovery must re-check token liveness and remove a lease recreated for a concurrently settled token');
    assert.match(startSource, /prepareLease[\s\S]*kv\.set\(activeKey, prepareLease[\s\S]*nx: true/,
        'prepare must atomically reserve the active slot instead of trusting a cacheable GET');
    assert.match(startSource, /const released = await kv\.delIfEqual\(activeKey, prepareLease\)[\s\S]*if \(!released\)[\s\S]*warfront-match-active/,
        'prepare may expose a seed only when it still owns and releases the active-slot marker');
    assert.match(startSource, /activeToken\.startsWith\('start-'\)[\s\S]*kind: 'in-flight'[\s\S]*warfront-start-in-flight/,
        'a concurrent identical start must receive the retryable in-flight contract rather than a generic conflict');

    const resultSource = readFileSync(join(process.cwd(), 'api', 'pet', 'battle-result.ts'), 'utf8');
    const maturityGuard = resultSource.indexOf("code: 'warfront-result-too-early'");
    const rewardLock = resultSource.indexOf('withKvLock(saveKey');
    const finalSaveCommit = resultSource.lastIndexOf('await writeSaveProjected(saveKey, updated, record)');
    const activeRelease = resultSource.lastIndexOf('await reconcileWarfrontActiveAuthorization(');
    assert.ok(maturityGuard >= 0 && rewardLock > maturityGuard,
        'too-early reports must fail before any settlement save mutation');
    assert.ok(finalSaveCommit >= 0 && activeRelease > finalSaveCommit,
        'the next seed unlocks only after the durable receipt/reward save commits');
    assert.match(resultSource, /replayed\.ticks \* 1000 \/ WARFRONT_TPS/,
        'Manual Council settlement must mature from its authoritative replay ticks');

    const clientSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'PetArena.tsx'), 'utf8');
    assert.match(clientSource, /blueSetup: authorization\.setup/,
        'reload recovery must render the setup sealed with the recovered authorization');
});
