import { kv,type KvCasOp } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { offlineNoticesKey, OFFLINE_NOTICES_TTL_SEC, parseOfflineNotices } from '../player/_offline-notices.js';
import { modelOwnerKey,validModelOwnerId,type ModelOwner } from './_owner.js';
import { withPrivateFileLock } from './_private-index.js';

type Row=Record<string,unknown>;
const prefix='avatar-model:';

/** Called while the account's save still exists. No credentials or save fields are rewritten here.
 *  `freeMonthlySlot` is for an operator server reset only; a player deletion keeps this month's slot. */
export async function detachModelAccount(owner:string,{freeMonthlySlot=false}:{freeMonthlySlot?:boolean}={}) {
    return withPrivateFileLock(async()=>{
        const saveKey='save:'+owner,save=await kv.get<{character?:{playerModelOwnerId?:string}}>(saveKey);
        const id=save?.character?.playerModelOwnerId;
        if(id===undefined) return;
        if(!validModelOwnerId(id)) throw new Error('Invalid model account identity');
        const ownerKey=modelOwnerKey(id),identity=await kv.get<ModelOwner>(ownerKey);
        if(identity?.owner!==owner || identity.id!==id || !['active','deleting'].includes(identity.state))
            throw new Error('Invalid model account ownership');
        const [jobKeys,assetKeys,readKeys]=await Promise.all([
            kv.keys(prefix+'job:*'),kv.keys(prefix+'asset:*'),kv.keys(prefix+'read:*')]);
        if(jobKeys.length+assetKeys.length+readKeys.length>30000) throw new Error('Model account cleanup needs maintenance');
        const [jobRows,assetRows,reads]=await Promise.all([
            kv.mget<Array<Row|null>>(...jobKeys),kv.mget<Array<Row|null>>(...assetKeys),kv.mget<Array<Row|null>>(...readKeys)]);
        const jobs=jobRows.flatMap((row,i)=>row?.slug===owner && row.accountId===id ? [{key:jobKeys[i],row}] : []);
        const assets=assetRows.flatMap((row,i)=>row?.owner===owner && row.accountId===id ? [{key:assetKeys[i],row}] : []);
        const ownJobIds=new Set(jobs.map(job=>job.key.slice((prefix+'job:').length)));
        const revisionKey=prefix+'revision:'+owner,revision=await kv.get<number>(revisionKey);
        if(revision!==null && (!Number.isSafeInteger(revision) || revision<0 || revision>=Number.MAX_SAFE_INTEGER))
            throw new Error('Invalid model account revision');
        const now=Date.now();
        const ops:KvCasOp[]=[{op:'assert',key:saveKey,expected:save},
            {op:'cas',key:ownerKey,expected:identity,value:{...identity,state:'deleting'}},
            {op:'cas',key:revisionKey,expected:revision,value:(revision??0)+1}];
        const dispatchKey=prefix+'dispatch',publishKey=prefix+'publish';
        const [dispatch,publish]=await Promise.all([kv.get<string[]>(dispatchKey),kv.get<string[]>(publishKey)]);
        const releases=new Map<string,number>();
        for(const {key,row} of jobs) {
            if(!['queued','render','validate'].includes(String(row.state))) continue;
            const jobId=key.slice((prefix+'job:').length);
            const unclaimed=row.state==='queued' && row.attempt===0 && dispatch?.includes(jobId);
            if(unclaimed) {
                if(!Array.isArray(row.reserved)) throw new Error('Invalid model reservation');
                for(const reservation of row.reserved as Array<{provider:string;cycle:string;micros:number}>) {
                    if(!['modal','openai'].includes(reservation.provider) || !/^[a-zA-Z0-9_-]{1,64}$/.test(reservation.cycle) ||
                        !Number.isSafeInteger(reservation.micros) || reservation.micros<0) throw new Error('Invalid model reservation');
                    const budgetKey=prefix+'budget:'+reservation.provider+':'+reservation.cycle;
                    releases.set(budgetKey,(releases.get(budgetKey)??0)+reservation.micros);
                }
            }
            ops.push({op:'cas',key,expected:row,value:{...row,state:'cancelled',errorCode:'account-deleted',endedAt:now,
                reserved:unclaimed ? [] : row.reserved}});
        }
        for(const [key,amount] of releases) {
            const row=await kv.get<{reservedMicros:number;spentMicros:number}>(key);
            if(!Number.isSafeInteger(amount) || !row || !Number.isSafeInteger(row.spentMicros) || row.spentMicros<0 ||
                !Number.isSafeInteger(row.reservedMicros) || row.reservedMicros<amount)
                throw new Error('Invalid model account budget');
            ops.push({op:'cas',key,expected:row,value:{...row,reservedMicros:row.reservedMicros-amount}});
        }
        for(const [key,queue] of [[dispatchKey,dispatch],[publishKey,publish]] as const) {
            if(queue!==null && (!Array.isArray(queue) || queue.some(item=>typeof item!=='string'))) throw new Error('Invalid model queue');
            if(queue?.some(jobId=>ownJobIds.has(jobId)))
                ops.push({op:'cas',key,expected:queue,value:queue.filter(jobId=>!ownJobIds.has(jobId))});
        }
        const cleanupKey=prefix+'cleanup',cleanup=await kv.get<string[]>(cleanupKey);
        if(cleanup!==null && !Array.isArray(cleanup)) throw new Error('Invalid model erasure queue');
        const cleanupIds=new Set(cleanup??[]);
        // Include a publication with an ambiguous acknowledgement, not only ready assets.
        const publicCandidates:Row[]=[...assets.map(asset=>asset.row),...jobs.filter(job=>Number(job.row.attempt)>0 || job.row.publishingAt).map(job=>({
            ...job.row,...(job.row.delivery as Row),owner,jobId:job.key.slice((prefix+'job:').length)}))];
        const seenAssets=new Set<string>();
        for(const row of publicCandidates) {
            if(typeof row.assetId!=='string' || !/^[a-f0-9]{32}$/.test(row.assetId) ||
                (row.version!==undefined && (typeof row.version!=='string' || !/^[a-f0-9]{64}$/.test(row.version))))
                throw new Error('Invalid model cleanup revision');
            if(seenAssets.has(row.assetId)) continue;
            seenAssets.add(row.assetId);
            const key=prefix+'cleanup:'+row.assetId;
            const prior=await kv.get<{accountId:string;jobId:string;state:string}>(key);
            if(prior && (prior.accountId!==id || prior.jobId!==row.jobId || !['pending','complete'].includes(prior.state)))
                throw new Error('Conflicting model cleanup');
            // A previous attempt may have finished erasure before reset retried.
            if(prior?.state==='complete') continue;
            if(!prior) ops.push({op:'cas',key,expected:null,value:{owner,accountId:id,assetId:row.assetId,version:row.version,
                sourceSha256:row.sourceSha256,masterSha256:row.masterSha256,privateRefKey:row.privateRefKey,jobId:row.jobId,
                createdAt:now,attempt:0,state:'pending',nextAttemptAt:row.publishingAt ? now+15*60_000 : now}});
            cleanupIds.add(row.assetId);
        }
        for(const {key,row} of assets) if(row.status!=='revoked')
            ops.push({op:'cas',key,expected:row,value:{...row,status:'revoked',revokedAt:now}});
        if(cleanupIds.size!==(cleanup??[]).length)
            ops.push({op:'cas',key:cleanupKey,expected:cleanup,value:[...cleanupIds]});
        const disposable=new Set<string>();
        for(const pattern of ['idem:'+owner+':*','screen:'+owner+':*','failures:'+owner+':*'])
            for(const key of await kv.keys(prefix+pattern)) disposable.add(key);
        // The monthly slot is keyed by name, so deleting it would hand a re-registered account of the same
        // name a fresh slot this month. Keep this month's row (it holds only a job id and timestamps) until
        // it can no longer matter, and drop older months.
        const currentSlotKey=prefix+'slot:'+owner+':'+new Date(now).toISOString().slice(0,7);
        for(const key of await kv.keys(prefix+'slot:'+owner+':*')) {
            const value=await kv.get(key);
            if(value===null) continue;
            ops.push(key===currentSlotKey && !freeMonthlySlot ? {op:'cas',key,expected:value,value,ex:32*86400} : {op:'delete',key,expected:value});
        }
        disposable.add(prefix+'active:'+owner);disposable.add(prefix+'last-refund:'+owner);
        reads.forEach((row,i)=>{if(row?.slug===owner && row.accountId===id) disposable.add(readKeys[i]);});
        for(const key of disposable) {
            const value=await kv.get(key);
            if(value!==null) ops.push({op:'delete',key,expected:value});
        }
        const inboxKey=offlineNoticesKey(owner);
        await withKvLock(inboxKey,async()=>{
            const raw=await kv.get(inboxKey);
            const notices=parseOfflineNotices(raw);
            const retained=notices.filter(notice=>notice.kind!=='world-model-removed' || notice.modelAccountId!==id);
            if(retained.length!==notices.length) ops.push(retained.length
                ? {op:'cas',key:inboxKey,expected:raw,value:retained,ex:OFFLINE_NOTICES_TTL_SEC}
                : {op:'delete',key:inboxKey,expected:raw});
            if(!await kv.compareSetMany?.(ops)) throw new Error('Model account changed during deletion');
        },{failClosed:true});
    });
}
