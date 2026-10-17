import type { AiFightRequest } from './ai-fight-request';

/** Match the receipt/chain as well as the catalog id. Two Frost Sealers can be
 * different encounters; a resumed receipt must not borrow the new one's face
 * or completion callback. */
export function sameAiFightIdentity(left: AiFightRequest, right: AiFightRequest): boolean {
    if (left.battleKind !== right.battleKind || left.sector !== right.sector) return false;
    // A sealed proof is more specific than a catalog suggestion from an older
    // client that had not received the descriptor yet.
    if (left.battleKind === 'explore' && left.worldExploreRequestId && right.worldExploreRequestId) return left.worldExploreRequestId === right.worldExploreRequestId;
    if (left.battleKind === 'raidAi' && left.raidToken && right.raidToken) return left.raidToken === right.raidToken;
    if (left.battleKind === 'dungeon' && left.dungeonRunToken && right.dungeonRunToken) return left.dungeonRunToken === right.dungeonRunToken;
    if (left.opponentId !== right.opponentId) return false;
    if (left.worldExploreRequestId !== right.worldExploreRequestId || left.raidToken !== right.raidToken
        || left.dungeonRunToken !== right.dungeonRunToken) return false;
    const a = left.worldEncounter, b = right.worldEncounter;
    if (!a || !b) return !a && !b;
    return a.kind === b.kind && a.sourceId === b.sourceId && a.sector === b.sector && (a.stage ?? 0) === (b.stage ?? 0)
        && a.chainId === b.chainId && a.decisionId === b.decisionId && (!a.encounterId || !b.encounterId || a.encounterId === b.encounterId);
}

export function resumedEncounterNotice(sealed: AiFightRequest, requested: AiFightRequest): string | undefined {
    return sameAiFightIdentity(sealed, requested) ? undefined
        : `Resuming your unfinished encounter with ${sealed.opponentName ?? 'this opponent'}. Finish it before starting ${requested.opponentName ?? 'the new encounter'}.`;
}

/** Only a matching sealed receipt may inherit a launcher's navigation, art and
 * presentation callback. Enemy identity and rewards always remain sealed. */
export function adoptRequestedFightPresentation(sealed: AiFightRequest, requested: AiFightRequest): AiFightRequest {
    if (!sameAiFightIdentity(sealed, requested)) return sealed;
    return { ...sealed,
        ...(requested.returnScreen ? { returnScreen: requested.returnScreen } : {}),
        ...(requested.enemyAvatar ? { enemyAvatar: requested.enemyAvatar } : {}),
        ...(requested.onResolved ? { onResolved: requested.onResolved } : {}),
    };
}
