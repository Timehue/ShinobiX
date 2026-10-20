import { BANDIT_TOLL_RYO } from '../../shared/road-toll.js';
import type { PlayerSaveMutation, PlayerSaveMutationContext } from '../save/_mutate-player-save.js';
import { currentWandererCooldownUntil, resolveNaturalWanderer, withWandererUseState } from './_wanderer-encounter.js';

type Receipt = { id: string; wandererId: string; at: number; cooldownUntil: number };
type Reply = Record<string, unknown>;

/** Receipt, wallet charge and bandit cooldown commit in the same save write. */
export function banditTollMutation(
    { character, record }: PlayerSaveMutationContext,
    id: string, wandererId: string, sector: number, now: number,
): PlayerSaveMutation<Reply> {
    const hp = Number(character.hp) || 0;
    const ryo = Number(character.ryo) || 0;
    const answer = (value: Reply): PlayerSaveMutation<Reply> => ({ ok: true, write: false, character, value });
    const receipts = (Array.isArray(record.banditTollReceipts) ? record.banditTollReceipts : []) as Receipt[];
    const prior = receipts.find(receipt => receipt.id === id);
    if (prior) {
        if (prior.wandererId !== wandererId) return answer({ ok: false, error: 'That payment belongs to a different bandit.' });
        return answer({ ok: true, replay: true, cost: { hp: 0, ryo: BANDIT_TOLL_RYO }, totals: { hp, ryo } });
    }
    const bandit = resolveNaturalWanderer(wandererId, now, character, sector);
    if (!Number.isSafeInteger(sector) || sector < 1 || bandit?.archetype !== 'bandit') {
        return answer({ ok: false, error: 'That bandit is no longer on this road.' });
    }
    if (currentWandererCooldownUntil(character, wandererId, now)) {
        return answer({ ok: false, error: 'You have already dealt with this bandit. Refresh the map.' });
    }
    if (ryo < BANDIT_TOLL_RYO) return answer({ ok: false, reason: 'no-ryo', error: `You need ${BANDIT_TOLL_RYO} ryo on hand to pay the toll.` });
    const used = withWandererUseState({ ...character, ryo: ryo - BANDIT_TOLL_RYO }, wandererId, now, sector);
    return {
        ok: true,
        character: used.character,
        recordPatch: { banditTollReceipts: [...receipts.filter(receipt => receipt.at > now - 86_400_000), { id, wandererId, at: now, cooldownUntil: used.cooldownUntil }] },
        value: { ok: true, cost: { hp: 0, ryo: BANDIT_TOLL_RYO }, totals: { hp, ryo: ryo - BANDIT_TOLL_RYO } },
    };
}
