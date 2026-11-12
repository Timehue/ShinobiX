import { createHash, randomBytes } from 'node:crypto';
import { signR2ObjectRequest } from '../_r2.js';
import { issueModelRead, validateModelRead, type ApprovedRead } from './_admission.js';
import { ensureModelOwner } from './_owner.js';
import { declarePrivateRead, extendPrivateJobFiles, withPrivateFileLock } from './_private-index.js';

const limits = { portraits: 3*1024*1024, masters: 128*1024, sheets: 16*1024*1024 };
type Kind = keyof typeof limits;
const digest = (data:Buffer)=>createHash('sha256').update(data).digest('hex');
export const paintedTemplates = new Set(['male-coat-template.json','female-coat-template.json','masked-collar-template.json']);

export function privateObjectRequest(kind:Kind|'profile-detail', hash:string, method:'PUT'|'GET'|'DELETE', bytes:Buffer=Buffer.alloc(0),
    conditions:Parameters<typeof signR2ObjectRequest>[4]={}) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid private object digest');
    const accountId=process.env.AVATAR_MODEL_R2_ACCOUNT_ID, bucket=process.env.AVATAR_MODEL_R2_PRIVATE_BUCKET;
    const accessKeyId=process.env.AVATAR_MODEL_R2_ACCESS_KEY_ID, secretAccessKey=process.env.AVATAR_MODEL_R2_SECRET_ACCESS_KEY;
    if (!accountId || !/^[a-f0-9]{32}$/.test(accountId) || !bucket || !/^[a-z0-9-]{3,63}$/.test(bucket)
        || bucket===process.env.R2_BUCKET || bucket===process.env.AVATAR_MODEL_R2_PUBLIC_BUCKET || !accessKeyId || !secretAccessKey)
        throw new Error('Private model storage unavailable');
    const signed=signR2ObjectRequest({accountId,bucket,accessKeyId,secretAccessKey},method,
        'avatar-model/private/'+kind+'/'+hash,{mime:'application/octet-stream',buf:bytes},conditions);
    return fetch(signed.url,{method,headers:signed.headers,redirect:'error',signal:AbortSignal.timeout(20000),
        body:method==='PUT'?new Blob([new Uint8Array(bytes)]):undefined});
}

export async function readPrivateModelFile(kind:Kind,hash:string):Promise<Buffer> {
    return readVerifiedPrivateObject(kind,hash,hash,limits[kind]);
}

export async function readVerifiedPrivateObject(kind: Kind|'profile-detail', key: string, hash: string, limit: number): Promise<Buffer> {
    const res=await privateObjectRequest(kind,key,'GET');
    if (!res.ok || !res.body || Number(res.headers.get('Content-Length'))>limit) {
        await res.body?.cancel();
        throw new Error('Private model object unavailable');
    }
    const reader=res.body.getReader(), parts:Uint8Array[]=[];
    let size=0;
    try {
        for (;;) {
            const {done,value}=await reader.read();
            if (done) break;
            size+=value.byteLength;
            if (size>limit) { await reader.cancel(); throw new Error('Oversize private model object'); }
            parts.push(value);
        }
    } finally { reader.releaseLock(); }
    const data=Buffer.concat(parts,size);
    if (digest(data)!==hash) throw new Error('Private model object digest mismatch');
    return data;
}

async function storePrivateFiles(files:[Kind,string,Buffer][]) {
    for (const [kind,hash,data] of files) {
        if (!data.length || data.length>limits[kind] || digest(data)!==hash) throw new Error('Invalid private model input');
    }
    // Immutable names make a retry after a partial upload safe. The read token
    // is issued only after a separate authenticated read verifies each object.
    const stored=await Promise.allSettled(files.map(async([kind,hash,data])=>{
        const res=await privateObjectRequest(kind,hash,'PUT',data,{ifNoneMatch:'*'});
        await res.body?.cancel();
        if(res.status===412) {
            const current=await privateObjectRequest(kind,hash,'GET');
            const tombstone=current.ok && current.headers.get('x-amz-meta-avatar-model-deleted')==='1' &&
                current.headers.get('Content-Length')==='32';
            const etag=current.headers.get('ETag');
            await current.body?.cancel();
            if(tombstone) {
                if(!etag) throw new Error('Missing private object version');
                const restored=await privateObjectRequest(kind,hash,'PUT',data,{ifMatch:etag});
                await restored.body?.cancel();
                if(!restored.ok) throw new Error('Private model object changed');
            }
        } else if (!res.ok) throw new Error('Unable to store private model input');
        await readPrivateModelFile(kind,hash);
    }));
    if(stored.some(result=>result.status==='rejected')) {
        const failure=stored.find(result=>result.status==='rejected') as PromiseRejectedResult;
        throw failure.reason;
    }
}

/** A fresh random marker erases the input and defeats earlier conditional uploads. */
export async function erasePrivateModelFile(kind:Kind,hash:string) {
    const marker=randomBytes(32);
    const result=await privateObjectRequest(kind,hash,'PUT',marker,{deleted:true});
    await result.body?.cancel();
    if(!result.ok) throw new Error('Unable to erase private model input');
    const readback=await privateObjectRequest(kind,hash,'GET');
    const erased=readback.ok && readback.headers.get('x-amz-meta-avatar-model-deleted')==='1' &&
        readback.headers.get('Content-Length')==='32';
    if(!erased) {await readback.body?.cancel();throw new Error('Private model erasure unconfirmed');}
    if(!readback.body) throw new Error('Private model erasure unconfirmed');
    const reader=readback.body.getReader(),parts:Uint8Array[]=[];
    let size=0;
    try {
        for(;;) {
            const {done,value}=await reader.read();
            if(done) break;
            size+=value.byteLength;
            if(size>32) {await reader.cancel();throw new Error('Private model erasure changed');}
            parts.push(value);
        }
    } finally {reader.releaseLock();}
    if(size!==32 || !Buffer.concat(parts,size).equals(marker)) throw new Error('Private model erasure changed');
}

function validateFit(source:string, descriptor:Buffer, sheet:Buffer, template:string) {
    const master=JSON.parse(descriptor.toString('utf8'));
    if (master.version!==1 || master.fit?.declined!==null || master.fit?.sourceSha256!==source
        || master.fit?.sheetSha256!==digest(sheet) || !/^[a-f0-9]{64}$/.test(template) || master.templateSha256!==template)
        throw new Error('Private master belongs to a different fit');
    return master.fit;
}

/** Accept trusted worker bytes only after input moderation. */
export async function sealModelRead(read:ApprovedRead,portrait:Buffer,descriptor:Buffer,sheet:Buffer):Promise<string> {
    validateModelRead(read);
    validateFit(read.sourceSha256,descriptor,sheet,read.kitVersion);
    if(!read.accountId) {
        const identity=await ensureModelOwner(read.slug);
        if(!identity.ok) throw new Error('Model account unavailable');
        read={...read,accountId:identity.value.id};
    }
    const bound={...read,sheetSha256:digest(sheet)};
    return withPrivateFileLock(async()=>{
        const privateRefKey=await declarePrivateRead({...bound,accountId:bound.accountId!});
        await storePrivateFiles([['portraits',bound.sourceSha256,portrait],['masters',bound.masterSha256,descriptor],['sheets',bound.sheetSha256,sheet]]);
        return issueModelRead({...bound,privateRefKey});
    });
}

export function validatePaintedFit(source:string, template:string, descriptor:Buffer, sheet:Buffer) {
    if (!descriptor.length || descriptor.length>limits.masters || !sheet.length || sheet.length>limits.sheets)
        throw new Error('Invalid painted file sizes');
    const fit=validateFit(source,descriptor,sheet,template);
    if (!/^[a-f0-9]{64}$/.test(fit.paintingSha256) ||
        !paintedTemplates.has(fit.template))
        throw new Error('Unverified painted costume');
}

export type PrivateJobContext={owner:string;accountId:string;jobId:string;referenceKey:string;revision:number};
export async function storePaintedFit(descriptor:Buffer, sheet:Buffer, context:PrivateJobContext) {
    const master=digest(descriptor);
    return withPrivateFileLock(async()=>{
        await extendPrivateJobFiles(context,[{kind:'masters',hash:master},{kind:'sheets',hash:digest(sheet)}]);
        await storePrivateFiles([['masters',master,descriptor],['sheets',digest(sheet),sheet]]);
        return master;
    });
}
