import { authedPlayer } from '../_auth.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { sharedImages } from '../images.js';
import { canCreatePlayerModel } from './_admission.js';
import { prepareProfileDetail, profileDigest, stageProfileDetail, withProfileDetailLock } from './_profile-detail.js';
import { readSavedPortrait } from './_saved-portrait.js';
import { modelResetKey, type ModelReset } from './_owner.js';

export const profileDetailUploadsEnabled = () => process.env.AVATAR_MODEL_PROFILE_DETAIL_ENABLED === '1';

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res,req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control','private, no-store');
    if (req.method !== 'POST') return res.status(405).end();
    if (!profileDetailUploadsEnabled()) return res.status(503).json({error:'disabled'});
    try {
        const reset = await kv.get<ModelReset>(modelResetKey);
        if (reset?.active) return res.status(503).json({error:'unavailable'});
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).json({error:'auth'});
        if (!await enforceRateLimitKv(req,res,'avatar-model-profile-detail',8,60_000,owner)) return;
        return await withProfileDetailLock(owner,async () => {
            const currentReset = await kv.get<ModelReset>(modelResetKey);
            if (currentReset?.active || currentReset?.id !== reset?.id) return res.status(503).json({error:'unavailable'});
            const save = await kv.get<{character?:{name?:unknown}}>('save:'+owner);
            if (!canCreatePlayerModel(save?.character)) return res.status(403).json({error:'entitlement'});
            const display = save?.character?.name;
            const alias = typeof display === 'string' && safeName(display) === owner ? display.toLowerCase() : owner;
            let detail;
            if (!process.env.AVATAR_MODEL_R2_SECRET_ACCESS_KEY) throw new Error('Private portrait storage unavailable');
            try { detail = await prepareProfileDetail(owner,req.body?.image); }
            catch { return res.status(400).json({error:'invalid-portrait'}); }
            const portrait = detail;
            req.body = {id:'avatar:'+alias,image:portrait.image};
            return sharedImages(req,res,async () => {
                const current = await readSavedPortrait(owner,save?.character);
                await stageProfileDetail(owner,current.decoded ? profileDigest(current.decoded.buf) : null,portrait);
            });
        });
    } catch { return res.status(503).json({error:'unavailable'}); }
}
