import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { sanitizeUserText } from '../_text-moderation.js';
import { buildNamedItem, debitNamedForge, rollNamedForge, type NamedRoll } from './_named.js';
import { recordForgedItem } from '../_forged-item-registry.js';
import { NAMED_ITEM_LEVEL_REQ } from '../../shared/item-level-gate.js';

const cleanToken = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9]{16,96}$/.test(v) ? v : '';

/**
 * Named gear is the level-90 tier (shared/item-level-gate.ts), so the FORGE
 * itself is gated, not just wearing the result. Rolling is gated too: letting a
 * level-20 player roll, name and pay for a piece they cannot equip for 70 levels
 * is a trap, and the roll is the step the player thinks of as "rolling for" one.
 * Reads the stored save — never a client-supplied level.
 */
async function forgeLevelBlocked(playerName: string): Promise<boolean> {
    const record = await kv.get<{ character?: { level?: unknown } }>(`save:${playerName}`);
    const level = Math.max(1, Math.floor(Number(record?.character?.level) || 1));
    return level < NAMED_ITEM_LEVEL_REQ;
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req); if (req.method === 'OPTIONS') return res.status(200).end(); if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? '')); const action = String(body.action ?? '');
        if (!playerName || !['roll', 'forge'].includes(action)) return res.status(400).json({ error: 'Invalid named-forge request.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your forge.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'craft-named', 60, 60_000, identity.name))) return;
        if (!identity.admin && await forgeLevelBlocked(playerName)) {
            return res.status(403).json({ error: `Named forging unlocks at level ${NAMED_ITEM_LEVEL_REQ}.`, requiredLevel: NAMED_ITEM_LEVEL_REQ });
        }
        if (action === 'roll') {
            const kind = body.kind === 'armor' ? 'armor' : 'weapon'; const roll = rollNamedForge(kind, body.slot);
            const token = randomUUID().replace(/-/g, '');
            await kv.set(`named-forge:${playerName}:${token}`, { playerName, roll }, { ex: 20 * 60 });
            return res.status(200).json({ ok: true, token, roll });
        }
        const token = cleanToken(body.token); if (!token) return res.status(400).json({ error: 'Invalid forge token.' });
        const result = await mutatePlayerSave<{ replayed: boolean; item: Record<string, unknown> | null }>(playerName, async ({ character, record }) => {
            const receipts = Array.isArray(character.redeemedNamedForges) ? character.redeemedNamedForges as string[] : [];
            if (receipts.includes(token)) return { ok: true as const, character, value: { replayed: true, item: null } };
            const sealed = await kv.get<{ playerName: string; roll: NamedRoll }>(`named-forge:${playerName}:${token}`);
            if (!sealed || sealed.playerName !== playerName) return { ok: false as const, status: 409, error: 'invalid-or-spent-roll' };
            const paid = debitNamedForge(character); if (!paid) return { ok: false as const, status: 409, error: 'insufficient-forge-materials' };
            const item = buildNamedItem(sealed.roll, sanitizeUserText(body.name, 60), sanitizeUserText(body.flavorText, 300));
            const inventory = Array.isArray(paid.inventory) ? paid.inventory as string[] : [];
            const creatorItems = Array.isArray(record.creatorItems) ? record.creatorItems as Array<Record<string, unknown>> : [];
            return { ok: true as const, character: { ...paid, inventory: [...inventory, item.id], redeemedNamedForges: [...receipts.slice(-49), token] }, recordPatch: { creatorItems: [...creatorItems.slice(-199), item] }, value: { replayed: false, item } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        // P0-3: durable definition registry — the in-save creatorItems copy is a
        // client-mirrored field, so a lost entry used to erase the item's only
        // definition. Best-effort post-commit: replay-safe (same id, same item).
        const mintedItem = (result.value as { item?: Record<string, unknown> })?.item;
        if (mintedItem) await recordForgedItem(mintedItem);
        await kv.del(`named-forge:${playerName}:${token}`).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) { console.error('[craft/named]', safeLogValue(error)); return res.status(500).json({ error: 'Internal server error.' }); }
}
