import { createHash } from 'node:crypto';
import { kv, type KvCasOp } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { mutatePlayerSaveLocked } from '../save/_mutate-player-save.js';
import { onlineStore } from '../_realtime/online-store.js';
import { pushSaveVersion } from '../_realtime/notify.js';
import { isPlayerModel, readPlayerModelSlots } from '../../shared/player-model-ref.js';
import { validModelOwnerId } from './_owner.js';
import { offlineNoticesKey, prepareOfflineNoticeWrite } from '../player/_offline-notices.js';

const prefix='avatar-model:';
type RemovalInput={slug:string;assetId:string;expectedVersion:string;reason:string;idempotencyKey:string};
type Result={assetId:string;cleanupPending:boolean;replayed:boolean};
type Job={slug:string;accountId:string;state:string;monthKey:string;attempt:number;publishingAt?:number;sourceSha256:string;
    masterSha256:string;originalMasterSha256?:string;recognition?:{nonce:string};
    reserved:Array<{provider:string;cycle:string;micros:number}>};
type Asset={owner:string;accountId:string;privateRefKey?:string;status:string;assetId:string;version:string;sourceSha256:string;masterSha256:string;jobId:string};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digest=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const cleanupPending=async(id:string)=>(await kv.get<{state:string}>(prefix+'cleanup:'+id))?.state!=='complete';

/** Trusted full-admin operation. One save commit revokes authority and records its cleanup/audit. */
export async function removePlayerModel(input:RemovalInput, actor:'admin:full') {
    if (!input || safeName(input.slug)!==input.slug || !input.slug || !/^[a-f0-9]{32}$/.test(input.assetId) ||
        !digest(input.expectedVersion) || typeof input.reason!=='string' || input.reason.trim().length<3 ||
        input.reason.length>500 || /\p{Cc}/u.test(input.reason) ||
        typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey) || actor!=='admin:full')
        return {ok:false as const,status:400,error:'Supply the player, current model revision, reason and request id.'};
    const owner=input.slug, assetKey=prefix+'asset:'+input.assetId;
    const receiptKey=prefix+'removal:'+hash(owner+'/'+input.idempotencyKey);
    const requestHash=hash(JSON.stringify([owner,input.assetId,input.expectedVersion,input.reason.trim()]));
    const inboxKey=offlineNoticesKey(owner);
    return withKvLock(prefix+'admit:'+owner,()=>withKvLock(prefix+'admit:budgets',()=>
        withKvLock('save:'+owner,()=>withKvLock(inboxKey,()=>mutatePlayerSaveLocked<Result>(owner,async({character})=>{
            const prior=await kv.get<{requestHash:string;assetId:string}>(receiptKey);
            if (prior) return prior.requestHash===requestHash
                ? {ok:true,character,write:false,value:{assetId:prior.assetId,cleanupPending:await cleanupPending(prior.assetId),replayed:true}}
                : {ok:false,status:409,error:'This request id belongs to a different removal.'};
            const asset=await kv.get<Asset>(assetKey);
            if (!asset || asset.owner!==owner || !validModelOwnerId(asset.accountId) ||
                asset.accountId!==character.playerModelOwnerId || asset.version!==input.expectedVersion)
                return {ok:false,status:409,error:'The model changed. Refresh before removing it.'};
            if (asset.status==='revoked') return {ok:true,character,write:false,
                value:{assetId:input.assetId,cleanupPending:await cleanupPending(input.assetId),replayed:true}};
            if (asset.status!=='ready') return {ok:false,status:409,error:'The model is not available for removal.'};
            const current=character.playerModel;
            if (isPlayerModel(current) && (current.assetId!==input.assetId || current.version!==input.expectedVersion))
                return {ok:false,status:409,error:'The equipped model changed. Refresh before removing it.'};
            const revisionKey=prefix+'revision:'+owner, activeKey=prefix+'active:'+owner;
            const [revision,active]=await Promise.all([kv.get<number>(revisionKey),kv.get<string>(activeKey)]);
            if (revision!==null && (!Number.isSafeInteger(revision) || revision<0 || revision>=Number.MAX_SAFE_INTEGER))
                throw new Error('Invalid model authority revision');
            const jobKey=active ? prefix+'job:'+active : null;
            const job=jobKey ? await kv.get<Job>(jobKey) : null;
            if (active && (!job || job.slug!==owner || job.accountId!==asset.accountId)) throw new Error('Invalid active model ownership');
            const now=Date.now(), nextRevision=(revision??0)+1;
            const ops:KvCasOp[]=[{op:'cas',key:revisionKey,expected:revision,value:nextRevision},
                active ? {op:'delete',key:activeKey,expected:active} : {op:'assert',key:activeKey,expected:null}];
            if (job && jobKey && ['queued','render','validate'].includes(job.state)) {
                const slotKey=prefix+'slot:'+owner+':'+job.monthKey;
                const slot=await kv.get<{jobId:string;reservedAt:number}>(slotKey);
                if (slot?.jobId!==active) throw new Error('Invalid active model slot');
                const dispatchKey=prefix+'dispatch',publishKey=prefix+'publish';
                const [dispatch,publish]=await Promise.all([kv.get<string[]>(dispatchKey),kv.get<string[]>(publishKey)]);
                const unclaimed=job.state==='queued' && job.attempt===0 && dispatch?.includes(active!);
                if (unclaimed) for(const r of job.reserved) {
                    const key=prefix+'budget:'+r.provider+':'+r.cycle;
                    const row=await kv.get<{reservedMicros:number;spentMicros:number}>(key);
                    if (!row || !Number.isSafeInteger(r.micros) || r.micros<0 ||
                        !Number.isSafeInteger(row.reservedMicros) || row.reservedMicros<r.micros)
                        throw new Error('Invalid unclaimed model reservation');
                    ops.push({op:'cas',key,expected:row,value:{...row,reservedMicros:row.reservedMicros-r.micros}});
                }
                ops.push({op:'cas',key:jobKey,expected:job,value:{...job,state:'cancelled',errorCode:'moderator-removed',
                    endedAt:now,reserved:unclaimed ? [] : job.reserved}},
                    {op:'cas',key:slotKey,expected:slot,value:{...slot,usedAt:now}});
                for(const [key,queue] of [[dispatchKey,dispatch],[publishKey,publish]] as const) {
                    if (queue?.includes(active!)) ops.push({op:'cas',key,expected:queue,value:queue.filter(id=>id!==active)});
                }
            }
            const cleanupKey=prefix+'cleanup:'+input.assetId, queueKey=prefix+'cleanup';
            const [cleanup,queue]=await Promise.all([kv.get(cleanupKey),kv.get<string[]>(queueKey)]);
            if (cleanup || (queue!==null && !Array.isArray(queue))) throw new Error('Invalid model cleanup queue');
            const receipt={requestHash,actor,owner,assetId:input.assetId,version:asset.version,jobId:active??null,
                removedAt:now,reason:input.reason.trim(),before:isPlayerModel(current)?current:null,after:null,
                revision:nextRevision,cleanupPending:true};
            ops.push(await prepareOfflineNoticeWrite(inboxKey,{kind:'world-model-removed',by:'moderation',sector:0,
                at:now,modelAccountId:asset.accountId}),
                {op:'cas',key:receiptKey,expected:null,value:receipt},
                {op:'cas',key:cleanupKey,expected:null,value:{owner,assetId:input.assetId,version:asset.version,
                    accountId:asset.accountId,privateRefKey:asset.privateRefKey,
                    sourceSha256:asset.sourceSha256,masterSha256:asset.masterSha256,jobId:asset.jobId,
                    cancelledJobId:active??null,createdAt:now,attempt:0,state:'pending',
                    nextAttemptAt:job?.publishingAt ? now+15*60_000 : now}},
                {op:'cas',key:queueKey,expected:queue,value:[...(queue??[]),input.assetId]});
            const slots = readPlayerModelSlots(character.playerModelSlots, current);
            if (slots[0]?.assetId === input.assetId) slots[0] = null;
            if (slots[1]?.assetId === input.assetId) slots[1] = null;
            return {ok:true,character:{...character,playerModel:undefined,playerModelSlots:slots.some(Boolean)?slots:undefined},
                value:{assetId:input.assetId,cleanupPending:true,replayed:false},
                atomicProof:{key:assetKey,expected:asset,value:{...asset,status:'revoked',revokedAt:now,
                    removalReceipt:receiptKey},additionalOps:ops},
                afterCommit:({ _saveVersion })=>{onlineStore.setPlayerModel(owner,null);pushSaveVersion(owner,_saveVersion);}};
        }),{failClosed:true}),{failClosed:true}),{failClosed:true}),{failClosed:true});
}
