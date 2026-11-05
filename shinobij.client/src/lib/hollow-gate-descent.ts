import type { HollowGateTileCtx } from './hollow-gate-tile';
import { loadHollowGateGenerator } from './hollow-gate-generator-loader';
import { descendHollowGateRun, HollowGateDescentError } from './hollow-gate-combat-api';
import { sealHollowGateFloor } from './hollow-gate-event-api';
import { applyAttunementToRun } from './hollow-gate-attunement';
import { hollowGateRunMaxFloor } from './hollow-gate-variant';

const defaults = { loadGenerator: loadHollowGateGenerator, descend: descendHollowGateRun, seal: sealHollowGateFloor };

/** One visible, retryable request for this account/run/floor's staircase. */
export function openHollowGateDescent(ctx: HollowGateTileCtx, flavor: string, overrides: Partial<typeof defaults> = {}): void {
    const run = ctx.hollowGateRun, character = ctx.character;
    if (!run || !character) return;
    const deps = { ...defaults, ...overrides }, id = crypto.randomUUID();
    const current = () => ctx.isCurrentRun?.() !== false;
    let inFlight = false;
    const patch = (pending: boolean, error?: string) => ctx.setHollowGateEvent(previous =>
        previous?.interactionId === id ? { ...previous, pending, ...(pending || error !== undefined ? { error } : {}) } : previous);
    const fail = (message: string) => { if (current()) { ctx.pushHollowGateLog(message); patch(false, message); } };
    const close = () => ctx.setHollowGateEvent(previous => previous?.interactionId === id ? null : previous);
    if (run.floor >= hollowGateRunMaxFloor(run)) {
        ctx.setHollowGateEvent({ title: 'Bottomless Staircase', body: 'This is the deepest floor.', kind: 'descend',
            choices: [{ label: 'Continue', onSelect: () => ctx.setHollowGateEvent(null), tone: 'primary' }] });
        return;
    }
    ctx.setHollowGateEvent({ title: 'Descend the Staircase', interactionId: id,
        body: `${flavor}\n\nDescend to Floor ${run.floor + 1}? You carry your keys and torch forward, with a small Reiki refill.`,
        kind: 'descend', choices: [
            { label: 'Descend deeper', tone: 'primary', onSelect: async () => {
                if (inFlight || !current()) return;
                if (!run.runToken) return fail('The staircase has no secure run seal. Reload to recover the run.');
                inFlight = true; patch(true);
                try {
                    // Load before committing. A lost committed reply can replay the same fromFloor safely.
                    const generator = await deps.loadGenerator();
                    if (!current()) return;
                    const floor = await deps.descend({ playerName: character.name, token: run.runToken, fromFloor: run.floor }, ctx.onVersionedCharacter);
                    if (!current()) return;
                    let next = applyAttunementToRun(generator.generateHollowGateShrineRun(floor, run.variant, run.serverSeed, false, true, "auto", { width: run.width, height: run.height }), character, false);
                    let sealed = await deps.seal(character.name, run.runToken, next);
                    if (!current()) return;
                    // A floor sealed by an earlier generator (a descent replayed
                    // across a deploy) is redrawn the way it was sealed.
                    for (const { secrets, layout } of generator.HOLLOW_GATE_BOARD_GENERATIONS?.slice(1) ?? []) {
                        if (sealed.ok || !/already sealed/i.test(sealed.error ?? '')) break;
                        const earlier = applyAttunementToRun(generator.generateHollowGateShrineRun(floor, run.variant, run.serverSeed, false, secrets, layout, { width: run.width, height: run.height }), character, false);
                        const retry = await deps.seal(character.name, run.runToken, earlier);
                        if (!current()) return;
                        if (retry.ok) { next = earlier; sealed = retry; }
                    }
                    if (!sealed.ok) return fail(sealed.error || 'The next floor could not be saved. Try the staircase again.');
                    ctx.setHollowGateRun({ ...next, keys: run.keys, torch: Math.min(10, run.torch + 4),
                        entryCurrencies: run.entryCurrencies, runToken: run.runToken, serverSeed: run.serverSeed,
                        riftDistortionId: run.riftDistortionId, augmentOffers: run.augmentOffers, chosenAugment: run.chosenAugment,
                        secondWindArmed: run.secondWindArmed, earnedXp: run.earnedXp, earnedFragments: run.earnedFragments, earnedVeils: run.earnedVeils,
                        detourTileIndex: sealed.detour?.tileIndex, detourExtraSteps: sealed.detour?.extraSteps,
                        riftSignalTileIndex: sealed.riftSignal?.tileIndex, wanderers: sealed.wanderers,
                        floorFeatures: sealed.floorFeatures, floorFeaturesVersion: sealed.floorFeatures ? 1 : undefined });
                    ctx.pushHollowGateLog(`You descend to Floor ${floor}. Torch flares: +4.`);
                    close();
                } catch (error) {
                    if (!current()) return;
                    if (error instanceof HollowGateDescentError && error.pendingAmbush && ctx.onPendingAmbush) {
                        ctx.pushHollowGateLog(error.message); close(); ctx.onPendingAmbush(error.pendingAmbush);
                    } else fail(error instanceof Error ? error.message : 'The staircase could not open. Retry when connected.');
                } finally { inFlight = false; if (current()) patch(false); }
            } },
            { label: 'Hold position', onSelect: close },
        ] });
}
