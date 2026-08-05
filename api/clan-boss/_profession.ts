import type { ClanBossContributionResult } from '../../shared/clan-boss-operation.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { professionRankForXp } from '../missions/_progress.js';
import type { Profession } from '../missions/_pool.js';

type OperationProfessionReceipt = { id: string; runId: string; xp: number; at: number };

export function operationProfessionXp(profession: string, contribution: ClanBossContributionResult): number {
    if (!contribution.active || !['healer', 'vanguard', 'petTamer'].includes(profession)) return 0;
    const base = contribution.threshold === 'elite' ? 130 : contribution.threshold === 'veteran' ? 90 : 50;
    const roleBonus = profession === 'healer'
        ? Math.min(20, Math.floor((contribution.healing + contribution.shielding) / 500) + contribution.cleanses * 5)
        : profession === 'vanguard'
            ? Math.min(20, Math.floor(contribution.damage / 1_000) + contribution.objective * 5)
            : Math.min(20, contribution.objective * 8 + (contribution.survived ? 10 : 0));
    return Math.max(50, Math.min(150, base + roleBonus));
}

export async function awardOperationProfessionXp(input: {
    playerName: string;
    runId: string;
    contribution: ClanBossContributionResult;
}): Promise<{ awarded: number; xp?: number; rank?: number; character?: Record<string, unknown> }> {
    const playerName = safeName(input.playerName);
    if (!playerName) return { awarded: 0 };
    const saveKey = `save:${playerName}`;
    const receiptId = `clanBoss:${input.runId}:profession`;
    return withKvLock(saveKey, async () => {
        const record = await kv.get<Record<string, unknown>>(saveKey);
        const character = record?.character as Record<string, unknown> | undefined;
        const profession = typeof character?.profession === 'string' ? character.profession : '';
        if (!record || !character || !['healer', 'vanguard', 'petTamer'].includes(profession)) return { awarded: 0 };
        const receipts = Array.isArray(character.operationProfessionReceipts)
            ? character.operationProfessionReceipts.filter((entry): entry is OperationProfessionReceipt => !!entry && typeof entry === 'object')
            : [];
        const prior = receipts.find((entry) => entry.id === receiptId);
        if (prior) return { awarded: 0, xp: Number(character.professionXp) || 0, rank: Number(character.professionRank) || 1, character };
        let awarded = operationProfessionXp(profession, input.contribution);
        const currentRank = Math.max(1, Math.floor(Number(character.professionRank) || 1));
        if (profession === 'vanguard' && currentRank >= 2) awarded = Math.floor(awarded * 1.1);
        if (awarded <= 0) return { awarded: 0, character };
        const xp = Math.max(0, Math.floor(Number(character.professionXp) || 0)) + awarded;
        const rank = professionRankForXp(profession as Profession, xp);
        const nextCharacter = {
            ...character,
            professionXp: xp,
            professionRank: rank,
            operationProfessionReceipts: [{ id: receiptId, runId: input.runId, xp: awarded, at: Date.now() }, ...receipts].slice(0, 30),
        };
        await kv.set(saveKey, mergePreservingImages(bumpSaveVersion({ ...record, character: nextCharacter }), record));
        return { awarded, xp, rank, character: nextCharacter };
    }, { failClosed: true });
}

