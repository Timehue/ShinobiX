import type { Dispatch, SetStateAction } from 'react';
import type { Character, HollowGateShrineRun, VersionedCharacterCommit } from '../types/character';
import type { Screen } from '../types/core';
import { HOLLOW_GATE_LOSS_HP_PERCENT } from '../../../shared/hollow-gate-loss';
import { settleHollowGateCardAmbush } from './hollow-gate-card-api';
import type { HollowGateEventModal } from './hollow-gate-tile';

export type HollowGateCardBinding = { token: string; nodeId: string; matchId: string };

/** The run-log line for a won card ambush, naming every currency the server paid. */
export function hollowGateCardWinLogLine(reward?: { ryo: number; auraDust: number; chroniclePoints?: number }): string {
    const points = Math.max(0, Math.floor(Number(reward?.chroniclePoints) || 0));
    const paid = [`+${reward?.ryo ?? 0} ryo`, `+${reward?.auraDust ?? 0} Aura Dust`, ...(points > 0 ? [`+${points} Chronicle Points`] : [])];
    return `The Chronicle Keeper falls. The card ambush seal breaks. ${paid.join(', ')}.`;
}

/** Leaving an unfinished match preserves its binding and offers its normal exits. */
export function leaveHollowGateCardAmbushFlow(params: {
    binding: HollowGateCardBinding | null;
    closeMatch: () => void;
    showShrine: () => void;
    setEvent: Dispatch<SetStateAction<HollowGateEventModal>>;
    resume: (binding: HollowGateCardBinding) => void;
    forfeit: () => void;
}) {
    const bound = params.binding;
    if (!bound) return;
    params.closeMatch();
    params.showShrine();
    params.setEvent({ title: 'Chronicle Ambush Sealed',
        body: 'The card match is still bound to this rift. Resume it to clear the corridor, or forfeit the run.',
        kind: 'tile_game', choices: [
            { label: 'Resume Showdown', tone: 'primary', onSelect: () => { params.setEvent(null); params.resume(bound); } },
            { label: 'Emergency forfeit', tone: 'danger', onSelect: () => { params.setEvent(null); params.forfeit(); } },
        ],
    });
}

/** Finish the exact bound match; a stale reply cannot reopen another run. */
export async function finishHollowGateCardAmbushFlow(params: {
    character: Character | null;
    binding: HollowGateCardBinding | null;
    isCurrent: () => boolean;
    commitCharacter: VersionedCharacterCommit;
    setRun: Dispatch<SetStateAction<HollowGateShrineRun | null>>;
    closeMatch: () => void;
    clearRun: () => void;
    pushLog: (line: string) => void;
    setScreen: (screen: Screen) => void;
}): Promise<void> {
    const { character, binding } = params;
    if (!character || !binding) throw new Error('The rift card binding is missing. Return to the shrine and resume it.');
    const settled = await settleHollowGateCardAmbush(character.name, binding.token, binding.matchId);
    if (!params.isCurrent()) return;
    if (!settled.ok || !settled.character) throw new Error(settled.error || 'The rift card result is still sealing. Retry Continue.');
    if (settled.character.name !== character.name || (settled.character.hollowGateRun?.runToken
        && settled.character.hollowGateRun.runToken !== binding.token)) throw new Error('The saved rift changed. Reload before continuing.');
    // An already-committed but stale save version still means the match ended.
    params.commitCharacter(settled.character, settled._saveVersion);
    params.closeMatch();
    if (settled.ended || settled.character.hollowGateRun === null || settled.character.hp <= 0) {
        params.clearRun();
        params.setScreen(settled.character.hospitalized || settled.character.hp <= 0 ? 'hospital' : 'worldMap');
        return;
    }
    params.setRun(previous => previous?.runToken === binding.token ? { ...previous, threat: 0, activeCombat: undefined } : previous);
    params.pushLog(settled.alreadyReported ? 'The Chronicle result was already sealed. The corridor is open.'
        : settled.won ? hollowGateCardWinLogLine(settled.reward)
            : `The Chronicle Keeper wins. The ambush seal fades; ${HOLLOW_GATE_LOSS_HP_PERCENT}% max HP recoils, stopping at 1 HP.`);
    params.setScreen('hollowGateShrine');
}
