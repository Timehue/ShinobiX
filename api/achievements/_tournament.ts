import { applyAchievementSync } from './_sync.js';

export function applyTournamentVictory(character: Record<string, unknown>, tournamentId: string): {
    character: Record<string, unknown>;
    replayed: boolean;
} {
    const receipts = Array.isArray(character.tournamentWinReceipts)
        ? character.tournamentWinReceipts.filter((entry): entry is string => typeof entry === 'string') : [];
    if (receipts.includes(tournamentId)) return { character, replayed: true };
    const progressed = {
        ...character,
        totalTournamentsCompleted: Math.max(0, Math.floor(Number(character.totalTournamentsCompleted) || 0)) + 1,
        tournamentWinReceipts: [...receipts.slice(-49), tournamentId],
    };
    return { character: applyAchievementSync(progressed).character, replayed: false };
}
