import { isVillageSupplyGood } from '../../shared/gathering.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { inventoryGrowthBlock } from '../_inventory-capacity.js';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { recordEconomyTxn } from '../_economy.js';
import { applyForge, type CraftKind } from './_forge.js';

const requestId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(v) ? v : '';
const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
/** The currency a craft moved, measured from the committed character (never from the request). */
type CraftDeltas = { fee: number; auraDust: number; boneCharms: number };
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const id = requestId(body.requestId);
        const kind = String(body.kind ?? '') as CraftKind; const recipeId = String(body.recipeId ?? '').slice(0, 96);
        if (!playerName || !id || !['supply', 'weapon', 'armor', 'relic'].includes(kind)) return res.status(400).json({ error: 'Invalid craft request.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your forge.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'craft-forge', 40, 60_000, identity.name))) return;
        // Set by the attempt that commits; a compare-and-set retry overwrites it.
        let deltas: CraftDeltas | null = null;
        const result = await mutatePlayerSave(playerName, ({ character }) => {
            deltas = null;
            const receipts = Array.isArray(character.redeemedCrafts) ? character.redeemedCrafts as string[] : [];
            if (receipts.includes(id)) return { ok: true as const, character, value: { replayed: true }, write: false as const };
            if (kind !== 'relic' && !Array.isArray(body.materials))
                return { ok: false as const, status: 400, error: 'Choose the exact materials for this craft first.' };
            if (isVillageSupplyGood(recipeId) && !villageStoresEnabled())
                return { ok: false as const, status: 409, error: 'Village Stores are unavailable. Keep your ingredients and try again when the stores reopen.' };
            const next = applyForge(character, kind, recipeId, body.quantity, body.materials);
            if (!next) return { ok: false as const, status: 409, error: 'This craft could not be completed. Check your selected quantities, stock, ryo and carry limit.' };
            // Judge the result, not the starting bag: consuming the recipe's
            // exact ingredients can free enough space for its output.
            //
            // `applyForge` is pure and `next` is discarded on refusal, so nothing
            // is spent either way: the "refuse before the spend" property holds.
            const grew = inventoryGrowthBlock(character, next);
            if (grew) return { ok: false as const, status: grew.status, error: grew.error };
            deltas = {
                fee: Math.max(0, whole(character.ryo) - whole(next.ryo)),
                auraDust: Math.max(0, whole(next.auraDust) - whole(character.auraDust)),
                boneCharms: Math.max(0, whole(next.boneCharms) - whole(character.boneCharms)),
            };
            return { ok: true as const, character: { ...next, redeemedCrafts: [...receipts.slice(-99), id] }, value: { replayed: false } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        // Economy telemetry (I-19): the forge fee sink and the currency a recipe
        // makes, after the commit, only for the request that crafted. A replayed
        // requestId committed nothing new and records nothing.
        const moved = deltas as CraftDeltas | null;
        if (!result.value.replayed && moved) {
            if (moved.fee > 0) {
                void recordEconomyTxn({ txnId: `craft:${playerName}:${id}:ryo`, player: playerName, currency: 'ryo', delta: -moved.fee, source: 'craft.fee', balanceAfter: whole(result.character.ryo) });
            }
            if (moved.auraDust > 0) {
                void recordEconomyTxn({ txnId: `craft:${playerName}:${id}:auraDust`, player: playerName, currency: 'auraDust', delta: moved.auraDust, source: 'craft.currency', balanceAfter: whole(result.character.auraDust) });
            }
            if (moved.boneCharms > 0) {
                void recordEconomyTxn({ txnId: `craft:${playerName}:${id}:boneCharms`, player: playerName, currency: 'boneCharms', delta: moved.boneCharms, source: 'craft.currency', balanceAfter: whole(result.character.boneCharms) });
            }
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[craft/forge]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
