import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { authedPlayer } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { admitModelJob, modelCreationPolicy } from './_admission.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res,req);
    if (req.method==='OPTIONS') return res.status(200).end();
    if (req.method!=='POST') return res.status(405).end();
    res.setHeader('Cache-Control','private, no-store');
    try {
        const owner=await authedPlayer(req);
        if (!owner) return res.status(401).json({error:'Authentication required.'});
        if (!(await enforceRateLimitKv(req,res,'avatar-model-admission',12,60_000,owner))) return;
        const body=req.body;
        if (!body || typeof body.readToken!=='string' || typeof body.idempotencyKey!=='string' || Object.keys(body).length!==2)
            return res.status(400).json({error:'input'});
        const result=await admitModelJob(owner,body.readToken,body.idempotencyKey,modelCreationPolicy());
        if ('jobId' in result) return res.status(202).json(result);
        const statuses={disabled:503,input:400,entitlement:403,quota:409,budget:429,'read-expired':409,busy:503};
        return res.status(statuses[result.error]).json(result);
    }catch(error){
        console.error('[avatar-model/admission]',safeLogValue(error));
        return res.status(503).json({error:'busy'});
    }
}
