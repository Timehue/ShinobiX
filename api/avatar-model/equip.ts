import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { sectorModelDisplayEnabled } from '../_release-flags.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isModelAssetId, isPlayerModel, readPlayerModelSlots, type PlayerModel } from '../../shared/player-model-ref.js';
import { modelOwnerProof } from './_owner.js';
import { isPatreonSubscriber } from '../_entitlements.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    res.setHeader('Cache-Control', 'no-store');
    try {
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).json({ error: 'Authentication required.' });
        if (!(await enforceRateLimitKv(req, res, 'avatar-model-equip', 30, 60_000, owner))) return;
        const body = req.body;
        if (body !== null && (!body || typeof body !== 'object' || !Object.hasOwn(body, 'assetId') ||
            Object.keys(body).some(key => key !== 'assetId' && key !== 'slot')))
            return res.status(400).json({ error: 'Supply the model to equip.' });
        const id: unknown = body === null ? null : body.assetId;
        const slot: unknown = body && Object.hasOwn(body, 'slot') ? body.slot : 1;
        if (id !== null && !isModelAssetId(id))
            return res.status(400).json({ error: 'Invalid model.' });
        if (slot !== 1 && slot !== 2) return res.status(400).json({ error: 'Invalid model slot.' });
        if (id !== null && !sectorModelDisplayEnabled()) return res.status(403).json({ error: 'Model display is disabled.' });
        const result = await mutatePlayerSave<PlayerModel | null>(owner, async ({ character }) => {
            if (slot === 2 && !isPatreonSubscriber(character))
                return { ok: false, status: 403, error: 'The second model slot requires Shinobi Supporter.' };
            const key = 'avatar-model:asset:' + id;
            const asset = id === null ? null : await kv.get<Record<string,unknown>>(key);
            const ref = id === null ? null : { assetId: id, version: asset?.version };
            const ownership=ref!==null && typeof asset?.accountId==='string' ? await modelOwnerProof(owner,asset.accountId) : null;
            if (ref !== null && (!ownership || asset?.accountId!==character.playerModelOwnerId ||
                asset?.owner !== owner || asset.status !== 'ready' || !isPlayerModel(ref)))
                return { ok: false, status: 404, error: 'Model unavailable.' };
            const model: PlayerModel | null = isPlayerModel(ref) ? ref : null;
            const current = character.playerModel;
            const publish = () => onlineStore.setPlayerModel(owner, model);
            const slots = readPlayerModelSlots(character.playerModelSlots, current);
            const alreadySaved = !model || slots[slot - 1]?.assetId === model.assetId && slots[slot - 1]?.version === model.version;
            if (alreadySaved && (model ? isPlayerModel(current) && current.assetId === model.assetId && current.version === model.version
                      : current == null)) {
                publish();
                return { ok: true, character, value: model, write: false };
            }
            if (model) {
                slots[slot - 1] = model;
                if (slots[2 - slot]?.assetId === model.assetId) slots[2 - slot] = null;
            }
            // Override the old field during the partial-save merge. JSON storage omits undefined.
            const next = { ...character, playerModel: model ?? undefined,
                playerModelSlots: slots.some(Boolean) ? slots : undefined };
            return { ok: true, character: next, value: model, afterCommit: publish,
                atomicProof: model ? { key, expected: asset, assertOnly: true,
                    additionalOps:ownership!.filter(op=>op.key!=='save:'+owner) } : undefined };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const snapshot = req.query.snapshot === '1' ? { character: result.character } : {};
        return res.status(200).json({ playerModel: result.value, _saveVersion: result._saveVersion, ...snapshot });
    } catch (error) {
        if (error instanceof Error && error.message === 'player-save-version-conflict')
            return res.status(409).json({ error: 'Equipment changed. Refresh and try again.' });
        console.error('[avatar-model/equip]', safeLogValue(error));
        return res.status(500).json({ error: 'Unable to change equipment.' });
    }
}
