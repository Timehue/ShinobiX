import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { LockContendedError } from '../../_lock.js';
import { actClanWarQueue, ClanWarQueueRefusal } from './_campaign-queue.js';
import { reconcileClanWarCampaign } from './_campaign-reconcile.js';
import { kv } from '../../_storage.js';
import { campaignMember } from '../../../shared/clan-war-campaign.js';
import type { ClanWar } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Sign in as your own shinobi to join a war queue.' });
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const warId = String(body.warId ?? '');
        if(body.action==='service-cancel'){
            if(!identity.admin)return res.status(403).json({error:'Service cancellation requires administrator authorization.'});
            const {cancelClanWarForService}=await import('./_campaign-service-cancel.js');
            const war=await cancelClanWarForService({warId,instanceId:String(body.instanceId??''),reason:String(body.reason??'')});
            return res.status(200).json({war,serverNow:Date.now()});
        }
        if(identity.admin)return res.status(403).json({error:'Sign in as your own shinobi to join a war queue.'});
        if(/^[a-z0-9-]{3,100}$/.test(warId)&&body.action==='provisions'){
            await reconcileClanWarCampaign(warId);
            const {activateClanWarProvisions}=await import('./_campaign-provisions.js');
            return res.status(200).json(await activateClanWarProvisions(warId,identity.name));
        }
        if(/^[a-z0-9-]{3,100}$/.test(warId)&&(body.action==='withdraw'||body.action==='surrender')){
            const {manageClanWarCampaign}=await import('./_campaign-management.js');
            return res.status(200).json(await manageClanWarCampaign(warId,identity.name,body.action));
        }
        if (/^[a-z0-9-]{3,100}$/.test(warId)) {
            const war = await kv.get<ClanWar>(`clan-war:${warId}`);
            if (!war?.campaign || !war.clans.some(clan=>campaignMember(war.campaign!,clan,identity.name))) {
                return res.status(403).json({error:'You are not on this war’s eligible roster.'});
            }
            await reconcileClanWarCampaign(warId);
        }
        return res.status(200).json(await actClanWarQueue({ ...body, warId: String(body.warId ?? ''),
            action: String(body.action ?? ''), playerName: identity.name }));
    } catch (error) {
        if (error instanceof ClanWarQueueRefusal) return res.status(error.status).json({ error: error.message });
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'The war queue is busy. Retry shortly.' });
        console.error('[clan/war/queue]', error);
        return res.status(500).json({ error: 'The queue could not update. Retry shortly.' });
    }
}
