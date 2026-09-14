

export function sanitizeChallengeProgress(char: Record<string, unknown>, exChar: Record<string, unknown>) {

    // ─── endlessTowerRun shape validation ─────────────────────────────────────
    // Run state is client-tracked then collected via save. Forged saves can
    // POST {wave: 9999, bankedRyo: 999999999, bankedXp: 999999999}. The
    // existing per-save ryo cap catches absurd ryo on the COLLECT step but
    // XP only has a rolling-window guard. Clamp the in-flight banked values
    // so the collect step can't ever credit more than these ceilings.
    const ET_BANKED_RYO_CAP = 100_000;
    const ET_BANKED_XP_CAP = 50_000;
    const ET_WAVE_CAP = 200;
    if (char.endlessTowerRun && typeof char.endlessTowerRun === 'object') {
        const run = char.endlessTowerRun as Record<string, unknown>;
        if (run.bankedRyo != null) run.bankedRyo = Math.max(0, Math.min(ET_BANKED_RYO_CAP, Number(run.bankedRyo) || 0));
        if (run.bankedXp != null) run.bankedXp = Math.max(0, Math.min(ET_BANKED_XP_CAP, Number(run.bankedXp) || 0));
        if (run.wave != null) run.wave = Math.max(0, Math.min(ET_WAVE_CAP, Math.floor(Number(run.wave) || 0)));
    }

    // ─── hollowGateRun shape bounds ───────────────────────────────────────────
    // Defense-in-depth on the persisted projection: bound absurd presentation
    // values even though the authoritative KV run owns the exact entry snapshot,
    // resources, event state, and settlement ledger.
    // A generic save cannot clear or replace an active server token. Otherwise a
    // browser could keep immediately committed run rewards while evading the
    // eventual extract/death reconciliation. Domain endpoints clear the stored
    // run directly after consuming the authoritative KV token.
    const storedHollowGateRun = exChar.hollowGateRun && typeof exChar.hollowGateRun === 'object'
        ? exChar.hollowGateRun as Record<string, unknown>
        : null;
    const storedHollowGateToken = typeof storedHollowGateRun?.runToken === 'string'
        ? storedHollowGateRun.runToken
        : '';
    const incomingHollowGateRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
        ? char.hollowGateRun as Record<string, unknown>
        : null;
    if (storedHollowGateToken && incomingHollowGateRun?.runToken !== storedHollowGateToken) {
        char.hollowGateRun = { ...storedHollowGateRun };
    } else if (storedHollowGateToken && incomingHollowGateRun) {
        for (const field of [
            'runToken', 'serverSeed', 'augmentOffers', 'chosenAugment',
            'entryCurrencies', 'keys', 'torch', 'threat', 'wardSteps',
            'secondWindArmed',
        ]) {
            if (storedHollowGateRun && field in storedHollowGateRun) incomingHollowGateRun[field] = storedHollowGateRun[field];
            else delete incomingHollowGateRun[field];
        }
    }
    if (exChar.lastHollowGateStart !== undefined) char.lastHollowGateStart = exChar.lastHollowGateStart;
    else delete char.lastHollowGateStart;

    if (char.hollowGateRun && typeof char.hollowGateRun === 'object') {
        const run = char.hollowGateRun as Record<string, unknown>;
        if (run.floor != null) run.floor = Math.max(0, Math.min(50, Math.floor(Number(run.floor) || 0)));
        if (run.keys != null) run.keys = Math.max(0, Math.min(99, Math.floor(Number(run.keys) || 0)));
        // This object is a bounded client projection of the live run. Token
        // identity, resources, movement, encounters, and its exact reward ledger
        // remain server-owned; generic saves cannot replace those fields.
        if (run.runToken != null) run.runToken = String(run.runToken).slice(0, 64);
        if (run.serverSeed != null) run.serverSeed = String(run.serverSeed).slice(0, 64);
        if (run.earnedXp != null) run.earnedXp = Math.max(0, Math.min(200_000, Math.floor(Number(run.earnedXp) || 0)));
        if (run.earnedFragments != null) run.earnedFragments = Math.max(0, Math.min(40, Math.floor(Number(run.earnedFragments) || 0)));
        if (run.earnedVeils != null) run.earnedVeils = Math.max(0, Math.min(25, Math.floor(Number(run.earnedVeils) || 0)));
        if (run.activeCombat && typeof run.activeCombat === 'object') {
            const active = run.activeCombat as Record<string, unknown>;
            const kind = String(active.kind ?? '');
            run.activeCombat = {
                runId: String(active.runId ?? '').slice(0, 96),
                nodeId: String(active.nodeId ?? '').slice(0, 96),
                floor: Math.max(1, Math.min(50, Math.floor(Number(active.floor) || 1))),
                kind: ['battle', 'elite', 'ambush', 'beast', 'boss'].includes(kind) ? kind : 'battle',
            };
        }
        if (Array.isArray(run.augmentOffers) && (run.augmentOffers as unknown[]).length > 8) {
            run.augmentOffers = (run.augmentOffers as unknown[]).slice(0, 8);
        }
    }

    // ─── Battle Towers progress array length caps ─────────────────────────────
    // These are display/convenience ledgers — the real reward gating is
    // server-side in api/towers/settle.ts (NX receipts + recompute), so a forged
    // array can't actually claim rewards. Cap length so it can't bloat KV.
    const BATTLE_TOWER_ARRAY_CAP = 500;
    for (const f of ['battleTowerClearedFloors', 'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed']) {
        const arr = (char as Record<string, unknown>)[f];
        if (Array.isArray(arr) && arr.length > BATTLE_TOWER_ARRAY_CAP) {
            (char as Record<string, unknown>)[f] = arr.slice(0, BATTLE_TOWER_ARRAY_CAP);
        }
    }

    // ─── defeatedAiIds length cap ─────────────────────────────────────────────
    // Drives "AI Hunter" achievement variants. Hard cap so a forged save
    // can't push the array to enormous lengths and bloat KV.
    const DEFEATED_AI_IDS_CAP = 5000;
    if (Array.isArray(char.defeatedAiIds) && (char.defeatedAiIds as unknown[]).length > DEFEATED_AI_IDS_CAP) {
        char.defeatedAiIds = (char.defeatedAiIds as unknown[]).slice(-DEFEATED_AI_IDS_CAP);
    }
}
