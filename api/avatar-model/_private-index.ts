import { randomUUID } from 'node:crypto';
import { kv, type KvCasOp } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { modelOwnerProof, validModelOwnerId } from './_owner.js';

export type PrivateFile={kind:'portraits'|'masters'|'sheets';hash:string};
export type PrivateReference={owner:string;accountId:string;files:PrivateFile[];sourceSha256:string;masterSha256:string;
    state:'read'|'job';createdAt:number;expiresAt:number;jobId?:string;retainedForRerender?:true};
export const privateReferenceKey=(id:string)=>'avatar-model:private-ref:'+id;
export const withPrivateFileLock=<T>(action:()=>Promise<T>)=>
    withKvLock('avatar-model:private-files',action,{failClosed:true,ttlSec:180});

export function canonicalPrivateFiles(files:PrivateFile[]):PrivateFile[] {
    if(!Array.isArray(files) || files.length>20 || files.some(f=>!f || !['portraits','masters','sheets'].includes(f.kind) ||
        typeof f.hash!=='string' || !/^[a-f0-9]{64}$/.test(f.hash))) throw new Error('Invalid private file references');
    return [...new Map(files.map(f=>[f.kind+'/'+f.hash,{kind:f.kind,hash:f.hash}])).values()]
        .sort((a,b)=>(a.kind+'/'+a.hash).localeCompare(b.kind+'/'+b.hash));
}

/** Declare ownership before object writes, so an interrupted read is still erasable. */
export async function declarePrivateRead(input:{slug:string;accountId:string;sourceSha256:string;masterSha256:string;
    sheetSha256?:string;operation?:string;expiresAt:number}) {
    if(!validModelOwnerId(input.accountId)) throw new Error('Missing private model owner');
    const guards=await modelOwnerProof(input.slug,input.accountId);
    if(!guards) throw new Error('Private model owner changed');
    const id=input.operation??randomUUID();
    if(!validModelOwnerId(id)) throw new Error('Invalid private read operation');
    const key=privateReferenceKey(id),prior=await kv.get<PrivateReference>(key);
    const files=canonicalPrivateFiles([{kind:'portraits',hash:input.sourceSha256},{kind:'masters',hash:input.masterSha256},
        ...(input.sheetSha256 ? [{kind:'sheets' as const,hash:input.sheetSha256}] : [])]);
    if(prior) {
        if(prior.owner!==input.slug || prior.accountId!==input.accountId || prior.state!=='read' ||
            prior.sourceSha256!==input.sourceSha256 || prior.masterSha256!==input.masterSha256 ||
            JSON.stringify(prior.files)!==JSON.stringify(files)) throw new Error('Private read operation changed');
        return key;
    }
    const row:PrivateReference={owner:input.slug,accountId:input.accountId,files,sourceSha256:input.sourceSha256,
        masterSha256:input.masterSha256,state:'read',createdAt:Date.now(),expiresAt:input.expiresAt};
    if(!await kv.compareSetMany?.([...guards,{op:'cas',key,expected:null,value:row}]))
        throw new Error('Unable to record private model ownership');
    return key;
}

/** Painting adds files only while this account and job still own the operation. */
export async function extendPrivateJobFiles(context:{owner:string;accountId:string;jobId:string;referenceKey:string;revision:number},files:PrivateFile[]) {
    const guards=await modelOwnerProof(context.owner,context.accountId);
    const ref=await kv.get<PrivateReference>(context.referenceKey);
    if(!guards || !/^avatar-model:private-ref:[a-f0-9-]{36}$/.test(context.referenceKey) || ref?.owner!==context.owner ||
        ref.accountId!==context.accountId || ref.jobId!==context.jobId || ref.state!=='job')
        throw new Error('Private model job ownership changed');
    const revision=await kv.get<number>('avatar-model:revision:'+context.owner);
    if((revision??0)!==context.revision) throw new Error('Private model revision changed');
    const ops:KvCasOp[]=[...guards,{op:'assert',key:'avatar-model:active:'+context.owner,expected:context.jobId},
        {op:'assert',key:'avatar-model:revision:'+context.owner,expected:revision},
        {op:'cas',key:context.referenceKey,expected:ref,value:{...ref,files:canonicalPrivateFiles([...ref.files,...files])}}];
    if(!await kv.compareSetMany?.(ops)) throw new Error('Private model job changed before storage');
}
