import { kv, type KvCasOp } from '../_storage.js';
import { canonicalPrivateFiles, withPrivateFileLock, type PrivateReference } from './_private-index.js';
import { modelOwnerKey, validModelOwnerId, type ModelOwner } from './_owner.js';
import { erasePrivateModelFile, readPrivateModelFile } from './_private-files.js';
import { withScheduledJobLease } from '../cron/_job-lease.js';

const prefix='avatar-model:';
const privateJobFields = ['summary', 'sourceKey', 'masterKey', 'originalMasterSha256', 'checkedPainting'] as const;

async function forgetPrivateJobDetails(ref: PrivateReference): Promise<KvCasOp | undefined> {
    if (ref.state !== 'job' || !ref.jobId) return;
    const key = prefix + 'job:' + ref.jobId;
    const job = await kv.get<Record<string, unknown>>(key);
    if (!job || job.slug !== ref.owner || job.accountId !== ref.accountId ||
        !['ready', 'failed', 'cancelled'].includes(String(job.state)) ||
        !privateJobFields.some(field => Object.hasOwn(job, field))) return;
    const retained = { ...job };
    for (const field of privateJobFields) delete retained[field];
    return { op: 'cas', key, expected: job, value: retained };
}

function validReference(row:PrivateReference) {
    if(!row || !validModelOwnerId(row.accountId) || typeof row.owner!=='string' ||
        !['read','job'].includes(row.state) || !Number.isSafeInteger(row.expiresAt))
        throw new Error('Invalid private model reference');
    return canonicalPrivateFiles(row.files);
}

async function cleanupDisposition(ref:PrivateReference,now:number) {
    const owner=await kv.get<ModelOwner>(modelOwnerKey(ref.accountId));
    if(owner?.id!==ref.accountId || owner.owner!==ref.owner) throw new Error('Unknown private model owner');
    if(owner.state==='deleting') return 'all';
    if(owner.state!=='active') throw new Error('Invalid private model owner state');
    if(ref.state==='read') return ref.expiresAt<=now ? 'all' : null;
    if(!ref.jobId) throw new Error('Missing private model job');
    const job=await kv.get<{slug:string;accountId:string;state:string;assetId?:string;publishingAt?:number;
        masterSha256:string;delivery?:{version:string}}>(prefix+'job:'+ref.jobId);
    if(job?.slug!==ref.owner || job.accountId!==ref.accountId) throw new Error('Unknown private model job');
    if(job.publishingAt && job.publishingAt+15*60_000>now) return null;
    if(['failed','cancelled'].includes(job.state)) return 'all';
    if(job.state!=='ready' || !job.assetId) return null;
    const asset=await kv.get<{accountId:string;owner?:string;jobId?:string;status:string;version?:string;
        masterSha256?:string}>(prefix+'asset:'+job.assetId);
    if(asset?.accountId!==ref.accountId || asset.owner!==ref.owner || asset.jobId!==ref.jobId) return null;
    if(asset.status==='revoked') return 'all';
    if(ref.retainedForRerender || asset.status!=='ready' || typeof asset.version!=='string' ||
        asset.version!==job.delivery?.version || asset.masterSha256!==job.masterSha256) return null;
    return {masterSha256:job.masterSha256};
}

/** Erase expired inputs and keep only the verified final fit for a published model. */
export async function erasePrivateReference(key:string,erase=erasePrivateModelFile,now=Date.now(),read=readPrivateModelFile) {
    if(!key.startsWith(prefix+'private-ref:') || !validModelOwnerId(key.slice((prefix+'private-ref:').length)))
        throw new Error('Invalid private reference key');
    return withPrivateFileLock(async()=>{
        const ref=await kv.get<PrivateReference>(key);
        if(!ref) return true;
        const files=validReference(ref);
        const disposition=await cleanupDisposition(ref,now);
        if(!disposition) return false;
        let retained:PrivateReference | undefined;
        if(disposition!=='all') {
            const {masterSha256}=disposition;
            if(!files.some(file=>file.kind==='masters' && file.hash===masterSha256))
                throw new Error('Published model master is not owned by the job');
            const descriptor=JSON.parse((await read('masters',masterSha256)).toString('utf8'));
            const sheetSha256=descriptor?.fit?.sheetSha256;
            if(descriptor?.fit?.sourceSha256!==ref.sourceSha256 ||
                !files.some(file=>file.kind==='sheets' && file.hash===sheetSha256))
                throw new Error('Published model sheet is not owned by the job');
            await read('sheets',sheetSha256);
            retained={...ref,masterSha256,retainedForRerender:true,
                files:canonicalPrivateFiles([{kind:'masters',hash:masterSha256},{kind:'sheets',hash:sheetSha256}])};
        }
        const keys=await kv.keys(prefix+'private-ref:*');
        // Do not use an incomplete census to authorize a destructive write.
        if(keys.length>10000) throw new Error('Private model reference census needs maintenance');
        const references=await kv.mget<Array<PrivateReference|null>>(...keys);
        const shared=new Set(retained?.files.map(file=>file.kind+'/'+file.hash));
        for(let i=0;i<references.length;i++) {
            if(keys[i]===key || !references[i]) continue;
            for(const file of validReference(references[i]!)) shared.add(file.kind+'/'+file.hash);
        }
        // Wait for all outcomes before releasing the file lock, including partial failures.
        const results=await Promise.allSettled(files.filter(file=>!shared.has(file.kind+'/'+file.hash))
            .map(async file=>{await kv.get(key);await erase(file.kind,file.hash);}));
        if(results.some(result=>result.status==='rejected')) throw new Error('Private model erasure remains pending');
        const minimized = await forgetPrivateJobDetails(ref);
        const ops: KvCasOp[] = [retained ? {op:'cas',key,expected:ref,value:retained} : {op:'delete',key,expected:ref}];
        if(minimized) ops.push(minimized);
        if(!await kv.compareSetMany?.(ops))
            throw new Error('Private model reference changed during erasure');
        return true;
    });
}

/** Bounded rotating census prevents active jobs from starving erasable inputs. */
export async function sweepPrivateModelReferences(erase=erasePrivateReference) {
    const keys=(await kv.keys(prefix+'private-ref:*')).sort();
    if(keys.length>10000) throw new Error('Private model reference census needs maintenance');
    const cursorKey=prefix+'private-cleanup-cursor',cursor=await kv.get<string>(cursorKey);
    const start=cursor ? keys.findIndex(key=>key>cursor) : 0;
    const ordered=start<0 ? keys : [...keys.slice(start),...keys.slice(0,start)];
    const started=Date.now();let checked=0,attempted=0,erased=0,failed=0,last=cursor;
    for(const key of ordered) {
        if(checked>=100 || attempted>=4 || Date.now()-started>90000) break;
        checked++;last=key;
        try {
            const ref=await kv.get<PrivateReference>(key);
            if(!ref) continue;
            validReference(ref);
            if(!await cleanupDisposition(ref,Date.now())) continue;
            attempted++;
            if(await erase(key)) erased++;
        } catch {failed++;}
    }
    if(last) await kv.set(cursorKey,last);
    const summary={checked,attempted,erased,failed,at:Date.now()};
    await kv.set(prefix+'private-cleanup-last',summary);
    return summary;
}

/** Erasure remains available when creation or paid dispatch is disabled. */
export async function tickPrivateModelCleanup() {
    if(process.env.AVATAR_MODEL_CLEANUP_ENABLED!=='1') return;
    await withScheduledJobLease('avatar-model-private-cleanup',()=>sweepPrivateModelReferences(),{ttlSec:300});
}
