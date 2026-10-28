import { kv, type KvLike } from './_storage.js';
import { safeName } from './_utils.js';
import { evaluateCreditedPvpFight } from './pvp/_valid-fight.js';

export class SectorWarPurseEvidenceUnavailableError extends Error {
    constructor(cause?: unknown) {
        super('sector-purse-account-evidence-unavailable', { cause });
        this.name = 'SectorWarPurseEvidenceUnavailableError';
    }
}

/** Read-only, inside the battle receipt's commit decision. Failures must escape
 * so a retry can obtain evidence before either the score or receipt is written.
 * Age is evaluated at the battle's end, never at a delayed settlement time.
 * PvP supplies sealed levels; pet/card owner levels come from authoritative saves.
 */
export async function sectorWarPurseEligible(args: {
    winnerName: string;
    loserName: string;
    endedAt: number;
    winnerLevel?: unknown;
    loserLevel?: unknown;
}, store: Pick<KvLike, 'get'> = kv): Promise<boolean> {
    const winner = safeName(args.winnerName), loser = safeName(args.loserName);
    if (!winner || !loser || winner === loser) return false;
    if (!Number.isSafeInteger(args.endedAt) || args.endedAt <= 0) throw new Error('sector-purse-battle-clock-invalid');
    const [winnerSave, loserSave] = await Promise.all([
        store.get<{ character?: Record<string, unknown> }>(`save:${winner}`),
        store.get<{ character?: Record<string, unknown> }>(`save:${loser}`),
    ]).catch(error => { throw new SectorWarPurseEvidenceUnavailableError(error); });
    // A missing save is unknown evidence, not a legacy account with a missing
    // createdAt field. Never turn a transient/missing read into a paid receipt.
    if (!winnerSave?.character || !loserSave?.character) throw new SectorWarPurseEvidenceUnavailableError();
    return evaluateCreditedPvpFight({
        winnerLevel: Number(args.winnerLevel ?? winnerSave.character.level),
        loserLevel: Number(args.loserLevel ?? loserSave.character.level),
        loserCreatedAt: loserSave.character.createdAt,
        terminalAt: args.endedAt,
    }).credited;
}
