import type { HollowGateShrineRun, HollowGateTile } from '../types/character';
import type { HollowGateMoveEffect } from './hollow-gate-movement-projection';
import { hollowGateStepInteraction, hollowGateSealedCombatOpts, sealHollowGateStep } from './hollow-gate-step-api';
import { hollowGateRunScopeMatches } from './hollow-gate-run-scope';

type Context = {
    playerName: string;
    run: HollowGateShrineRun;
    currentPlayer: () => string | undefined;
    currentRun: () => HollowGateShrineRun | null;
    queue: { current: HollowGateMoveEffect[] };
    setRun: (update: (previous: HollowGateShrineRun | null) => HollowGateShrineRun | null) => void;
    log: (line: string) => void;
    stopWalk: () => void;
    acceptVersion: (version: number | undefined, player: string) => void;
    openPending: (pending: { token: string; floor: number; nodeId: string; kind: 'battle' | 'ambush' | 'boss' | 'card' }) => void;
    openBattle: (opts: ReturnType<typeof hollowGateSealedCombatOpts>) => void | Promise<void>;
    resolveTile: (tile: HollowGateTile, x: number, y: number, wanderers?: HollowGateShrineRun['wanderers']) => Promise<void>;
    sealStep?: typeof sealHollowGateStep;
};

/** Serialize accepted movement and tile consequences within one account/floor.
 * A modal stops both the visible walker and the already-captured input batch. */
export async function drainHollowGateMovement(ctx: Context) {
    const current = () => ctx.currentPlayer() === ctx.playerName && hollowGateRunScopeMatches(ctx.currentRun(), ctx.run);
    if (!current() || !ctx.run.runToken) return;
    const queue = ctx.queue.current;
    ctx.queue.current = [];
    const patch = (update: (run: HollowGateShrineRun) => HollowGateShrineRun) => ctx.setRun(previous => current() && hollowGateRunScopeMatches(previous, ctx.run) ? update(previous!) : previous);
    const stop = () => { ctx.stopWalk(); ctx.queue.current = []; };
    for (const fx of queue) {
        if (!current()) return;
        if (fx.wallBump) { ctx.log(fx.blockMessage ?? 'Solid shrine stone. You cannot pass.'); continue; }
        if (fx.committedTheme) ctx.log(`You commit to the ${fx.committedTheme === 'treasure' ? 'Treasure' : 'Beast'} wing — the other detour seals behind you. The Trial path remains open.`);
        if (!fx.step) continue;
        const step = await (ctx.sealStep ?? sealHollowGateStep)({ playerName: ctx.playerName, token: ctx.run.runToken, floor: ctx.run.floor, floorFeaturesVersion: ctx.run.floorFeaturesVersion, ...fx.step });
        if (!current()) return;
        if (!step.ok) {
            stop(); ctx.log(step.error || 'The shrine rejected that step.');
            patch(previous => ({ ...previous, playerX: step.position?.x ?? fx.step!.fromX, playerY: step.position?.y ?? fx.step!.fromY }));
            if (step.pendingAmbush) ctx.openPending({ ...step.pendingAmbush, token: ctx.run.runToken, floor: ctx.run.floor });
            else if (step.activeCombat) patch(previous => ({ ...previous, activeCombat: step.activeCombat }));
            else if (step.sealedCombat) void ctx.openBattle(hollowGateSealedCombatOpts(step.sealedCombat));
            return;
        }
        ctx.acceptVersion(step._saveVersion, ctx.playerName);
        // Preserve inputs that are visually ahead of this accepted step.
        patch(previous => ({ ...previous, torch: step.torch ?? previous.torch, threat: step.threat ?? previous.threat,
            wardSteps: step.wardSteps ?? previous.wardSteps, ...(step.wanderers ? { wanderers: step.wanderers } : {}) }));
        if (step.torchSputtered) ctx.log('The Torch of Reiki sputters out. Threat builds faster in the dark.');
        const interaction = hollowGateStepInteraction(ctx.currentRun()!, step, fx);
        if (interaction) await ctx.resolveTile(interaction.tile, interaction.nx, interaction.ny, step.wanderers);
        if (!current()) return; // A staircase or extraction can replace this floor.
        const stopsAtInteraction = interaction && interaction.tile.kind !== 'empty' && interaction.tile.kind !== 'shard_vein';
        if (stopsAtInteraction || step.ambush) {
            stop(); patch(previous => ({ ...previous, playerX: step.position?.x ?? fx.step!.toX, playerY: step.position?.y ?? fx.step!.toY }));
        }
        if (step.ambush) {
            const kind = interaction?.tile.kind;
            if (kind !== 'battle' && kind !== 'elite' && kind !== 'boss' && kind !== 'pet_battle' && kind !== 'tile_game')
                ctx.openPending({ ...step.ambush, token: ctx.run.runToken, floor: ctx.run.floor });
            return;
        }
        if (stopsAtInteraction) return;
    }
}
