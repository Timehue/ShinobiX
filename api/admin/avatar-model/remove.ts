import type { ApiRequest, ApiResponse } from '../../_vercel.js';
import { isFullAdmin } from '../../_auth.js';
import { cors } from '../../_utils.js';
import { safeLogValue } from '../../_safe-log.js';
import { removePlayerModel } from '../../avatar-model/_removal.js';

export default async function handler(req:ApiRequest,res:ApiResponse) {
    cors(res,req);
    if (req.method==='OPTIONS') return res.status(200).end();
    if (req.method!=='POST') return res.status(405).end();
    res.setHeader('Cache-Control','no-store');
    if (!isFullAdmin(req)) return res.status(403).json({error:'Full admin access required.'});
    try {
        let body=req.body;
        if(typeof body==='string') {
            try {body=JSON.parse(body);} catch {return res.status(400).json({error:'Invalid model removal request.'});}
        }
        const keys=['slug','assetId','expectedVersion','reason','idempotencyKey'];
        if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==keys.length ||
            keys.some(k=>typeof body[k]!=='string')) return res.status(400).json({error:'Invalid model removal request.'});
        const result=await removePlayerModel(body,'admin:full');
        if (!result.ok) return res.status(result.status).json({error:result.error});
        return res.status(200).json({...result.value,_saveVersion:result._saveVersion});
    } catch(error) {
        if (error instanceof Error && error.message==='player-save-version-conflict')
            return res.status(409).json({error:'The player changed. Refresh and try again.'});
        console.error('[avatar-model/remove]',safeLogValue(error));
        return res.status(503).json({error:'Unable to remove the model. Refresh to check its status.'});
    }
}
