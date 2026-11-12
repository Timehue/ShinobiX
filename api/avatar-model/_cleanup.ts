import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { kv,type KvCasOp } from '../_storage.js';
import { withScheduledJobLease } from '../cron/_job-lease.js';
import { modelOwnerKey,validModelOwnerId,type ModelOwner } from './_owner.js';
import { erasePrivateReference, tickPrivateModelCleanup } from './_private-cleanup.js';
import { sweepDeletedModelOwners } from './_account-erasure.js';

const prefix='avatar-model:';
type Row=Record<string,unknown>;
type Cleanup={owner:string;accountId:string;assetId:string;version?:string;jobId:string;cancelledJobId?:string|null;
    state:'pending'|'complete';createdAt:number;nextAttemptAt:number;attempt:number};
type CleanupRequest={assets:string[];journals:Array<{assetId:string;masterSha256:string;nonce:string}>};
type CleanupReply={status:'complete';requestSha256:string;assets:string[];journals:number;objectsDeleted:number;purgeIds:string[]};
const sha=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const validAsset=(value:unknown):value is string=>typeof value==='string' && /^[a-f0-9]{32}$/.test(value);
const validDigest=(value:unknown):value is string=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);

async function eraseStoredModel(request:CleanupRequest):Promise<CleanupReply> {
    const python=process.env.AVATAR_MODEL_CLEANUP_PYTHON??process.env.AVATAR_MODEL_MODAL_PYTHON;
    if(!python) throw new Error('Model cleanup interpreter unavailable');
    return new Promise((accept,reject)=>{
        const child=spawn(python,[resolve('workers/avatar-model/cleanup_sprite.py')],{
            stdio:['pipe','pipe','ignore'],windowsHide:true,timeout:120000});
        let output='';
        child.on('error',reject);child.stdin.on('error',reject);
        child.stdout.setEncoding('utf8').on('data',(data:string)=>{output+=data;if(output.length>8192) child.kill();});
        child.on('close',code=>{
            if(code!==0 || output.length>8192) return reject(new Error('Stored model erasure unconfirmed'));
            try{accept(JSON.parse(output));}catch{reject(new Error('Invalid model erasure receipt'));}
        });
        child.stdin.end(JSON.stringify(request));
    });
}

/** Resolve only terminal jobs belonging to this exact revoked account/asset. */
async function cleanupAuthority(row:Cleanup) {
    if(!validAsset(row.assetId) || !validModelOwnerId(row.accountId) || typeof row.owner!=='string' ||
        typeof row.jobId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.jobId) ||
        (row.version!==undefined && !validDigest(row.version)) || !Number.isSafeInteger(row.attempt) || row.attempt<0)
        throw new Error('Invalid model cleanup authority');
    const ownerKey=modelOwnerKey(row.accountId),owner=await kv.get<ModelOwner>(ownerKey);
    const assetKey=prefix+'asset:'+row.assetId,asset=await kv.get<Row>(assetKey);
    const guards:KvCasOp[]=[];
    if(owner?.owner!==row.owner || owner.id!==row.accountId || !['active','deleting'].includes(owner.state))
        throw new Error('Model cleanup account changed');
    if(asset) {
        if(asset.owner!==row.owner || asset.accountId!==row.accountId || asset.status!=='revoked' ||
            asset.version!==row.version || asset.jobId!==row.jobId) throw new Error('Model is not revoked');
        guards.push({op:'assert',key:assetKey,expected:asset});
    }
    guards.push({op:'assert',key:ownerKey,expected:owner});
    const ids=[...new Set([row.jobId,...(row.cancelledJobId ? [row.cancelledJobId] : [])])];
    if(ids.length>2 || ids.some(id=>!/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid model cleanup jobs');
    const assets=new Set([row.assetId]);
    const privateRefs=new Set<string>();
    const journals=new Map<string,{assetId:string;masterSha256:string;nonce:string}>();
    for(const id of ids) {
        const key=prefix+'job:'+id,job=await kv.get<Row>(key);
        if(!job || job.slug!==row.owner || job.accountId!==row.accountId || !validAsset(job.assetId) ||
            !['ready','failed','cancelled'].includes(String(job.state))) throw new Error('Model cleanup job is not terminal');
        if(id===row.jobId && job.assetId!==row.assetId) throw new Error('Model cleanup job changed');
        if(id===row.jobId && !asset && owner.state!=='deleting' && job.state==='ready')
            throw new Error('Completed model cleanup has no revocation');
        if(job.publishingAt && (typeof job.publishingAt!=='number' || job.publishingAt+15*60000>Date.now()))
            throw new Error('Model publication is still settling');
        if(id!==row.jobId && job.state==='ready') throw new Error('Cancelled cleanup job is still ready');
        if(typeof job.privateRefKey!=='string' || !job.privateRefKey.startsWith(prefix+'private-ref:') ||
            !validModelOwnerId(job.privateRefKey.slice((prefix+'private-ref:').length)))
            throw new Error('Model cleanup has no private ownership index');
        privateRefs.add(job.privateRefKey);
        assets.add(job.assetId);
        const recognition=job.recognition as {nonce?:unknown}|undefined;
        if(recognition) {
            if(!validDigest(job.masterSha256) || !validDigest(recognition.nonce)) throw new Error('Invalid model cleanup journal');
            const journal={assetId:job.assetId,masterSha256:job.masterSha256,nonce:recognition.nonce};
            journals.set(Object.values(journal).join('/'),journal);
        }
        // Late billing identities may still append to the job. Do not pin a stale whole job receipt.
    }
    const request:CleanupRequest={assets:[...assets].sort(),journals:[...journals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v)};
    return {guards,request,privateRefs};
}

/** A failed deletion or cache purge leaves its durable queue entry pending. */
export async function advanceModelCleanup(assetId:string,erase=eraseStoredModel,erasePrivate=erasePrivateReference) {
    if(!validAsset(assetId)) throw new Error('Invalid model erasure id');
    const key=prefix+'cleanup:'+assetId,row=await kv.get<Cleanup>(key);
    if(!row || row.state==='complete' || row.nextAttemptAt>Date.now()) return;
    if(row.assetId!==assetId || row.state!=='pending') throw new Error('Invalid model erasure row');
    try {
        const {guards,request,privateRefs}=await cleanupAuthority(row);
        const reply=await erase(request);
        if(reply?.status!=='complete' || reply.requestSha256!==sha(JSON.stringify(request)) ||
            JSON.stringify(reply.assets)!==JSON.stringify(request.assets) || reply.journals!==request.journals.length ||
            !Number.isSafeInteger(reply.objectsDeleted) || reply.objectsDeleted<0 || reply.objectsDeleted>16384 ||
            !Array.isArray(reply.purgeIds) || reply.purgeIds.length!==request.assets.length ||
            reply.purgeIds.some(id=>typeof id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
            throw new Error('Model erasure receipt does not match');
        for(const key of privateRefs) if(!await erasePrivate(key)) throw new Error('Private model files remain in use');
        const queueKey=prefix+'cleanup',queue=await kv.get<string[]>(queueKey);
        if(!queue?.includes(assetId)) throw new Error('Model erasure queue changed');
        if(!await kv.compareSetMany?.([...guards,{op:'cas',key,expected:row,value:{...row,state:'complete',
            completedAt:Date.now(),receipt:reply}},
            {op:'cas',key:queueKey,expected:queue,value:queue.filter(id=>id!==assetId)}]))
            throw new Error('Model erasure authority changed');
    } catch {
        const attempt=row.attempt+1;
        await kv.compareSetMany?.([{op:'cas',key,expected:row,value:{...row,attempt,
            nextAttemptAt:Date.now()+Math.min(6*60*60000,60000*2**Math.min(attempt-1,9)),lastFailureAt:Date.now(),
            lastFailureCode:'unconfirmed-erasure'}}]);
    }
}

export async function sweepPublicModelCleanup(advance = advanceModelCleanup) {
    const queue = await kv.get<string[]>(prefix + 'cleanup');
    if (queue === null) return;
    if (!Array.isArray(queue) || queue.length > 10000 || queue.some(id => !validAsset(id))) {
        throw new Error('Invalid model cleanup queue');
    }
    const cursorKey = prefix + 'public-cleanup-cursor';
    const cursor = await kv.get<string>(cursorKey);
    const keys = [...queue].sort();
    const start = cursor ? keys.findIndex(key => key > cursor) : 0;
    const ordered = start < 0 ? keys : [...keys.slice(start), ...keys.slice(0, start)];
    let last = cursor;
    for (const id of ordered.slice(0, 100)) {
        last = id;
        const row = await kv.get<Cleanup>(prefix + 'cleanup:' + id);
        if (row?.state !== 'pending' || row.nextAttemptAt > Date.now()) continue;
        try { await advance(id); }
        catch { console.warn('[avatar-model] Public cleanup needs attention'); }
        break;
    }
    if (last) await kv.set(cursorKey, last);
}

export async function tickModelCleanup() {
    if(process.env.AVATAR_MODEL_CLEANUP_ENABLED!=='1') return;
    try{await tickPrivateModelCleanup();}catch{console.warn('[avatar-model] Private cleanup remains pending');}
    await withScheduledJobLease('avatar-model-public-cleanup', () => sweepPublicModelCleanup(), {ttlSec:300});
    try {
        await withScheduledJobLease('avatar-model-account-erasure', sweepDeletedModelOwners,
            {ttlSec:300, holdUntilExpiryOnSuccess:true});
    } catch {
        console.warn('[avatar-model] Account record erasure remains pending');
    }
}
