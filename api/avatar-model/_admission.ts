import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isPatreonSubscriber } from '../_entitlements.js';
import { withKvLock } from '../_lock.js';
import { kv, type KvCasOp } from '../_storage.js';
import { scheduledJobsDisabled } from '../_launch-controls.js';
import { sectorModelDisplayEnabled } from '../_release-flags.js';
import { readSavedPortrait } from './_saved-portrait.js';
import { isRecognitionPolicy, type RecognitionPolicy } from './_recognition.js';
import { ensureModelOwner, modelOwnerProof, validModelOwnerId } from './_owner.js';
import { declarePrivateRead, withPrivateFileLock, type PrivateReference } from './_private-index.js';

const prefix = 'avatar-model:';
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const canCreatePlayerModel = (character: unknown) => isPatreonSubscriber(character);
export function playerPortraitChecksEnabled() {
    return process.env.AVATAR_MODEL_CREATION_ENABLED === '1' && process.env.AVATAR_MODEL_KILL_SWITCH !== '1' &&
        [process.env.AVATAR_MODEL_READ_DAILY_LIMIT, process.env.AVATAR_MODEL_READ_PLAYER_DAILY_LIMIT]
            .every(limit => Number.isSafeInteger(Number(limit)) && Number(limit) > 0);
}
export type ProviderReservation = { provider: 'modal' | 'openai'; cycle: string; limitMicros: number; perAttemptMicros: number };
export type AdmissionPolicy = { enabled: boolean; dailyLimit: number; providers: ProviderReservation[]; recognition?:RecognitionPolicy };

/** Static readiness for new requests. Provider access is verified separately at deployment. */
export function modelCreationPolicy(): AdmissionPolicy {
    const disabled: AdmissionPolicy = { enabled: false, dailyLimit: 0, providers: [] };
    const env = process.env;
    if (!playerPortraitChecksEnabled() || !sectorModelDisplayEnabled() || scheduledJobsDisabled() ||
        env.AVATAR_MODEL_DISPATCH_ENABLED !== '1' || env.AVATAR_MODEL_CLEANUP_ENABLED !== '1')
        return disabled;
    if (![env.AVATAR_MODEL_OPENAI_API_KEY, env.AVATAR_MODEL_MODAL_PYTHON, env.AVATAR_MODEL_MODAL_ENVIRONMENT,
        env.AVATAR_MODEL_MODAL_TOKEN_ID, env.AVATAR_MODEL_MODAL_TOKEN_SECRET,
        env.AVATAR_MODEL_CLEANUP_PYTHON ?? env.AVATAR_MODEL_MODAL_PYTHON,
        env.AVATAR_MODEL_R2_ACCESS_KEY_ID, env.AVATAR_MODEL_R2_SECRET_ACCESS_KEY,
        env.AVATAR_MODEL_R2_PUBLIC_ACCESS_KEY_ID, env.AVATAR_MODEL_R2_PUBLIC_SECRET_ACCESS_KEY,
        env.AVATAR_MODEL_CDN_PURGE_TOKEN].every(value => value?.trim()))
        return disabled;
    const privateBucket = env.AVATAR_MODEL_R2_PRIVATE_BUCKET ?? '';
    const publicBucket = env.AVATAR_MODEL_R2_PUBLIC_BUCKET ?? '';
    if (![env.AVATAR_MODEL_R2_ACCOUNT_ID, env.AVATAR_MODEL_CDN_ZONE_ID].every(value => /^[a-f0-9]{32}$/.test(value ?? '')) ||
        ![privateBucket, publicBucket].every(bucket => /^[a-z0-9-]{3,63}$/.test(bucket)) ||
        privateBucket === publicBucket || privateBucket === env.R2_BUCKET)
        return disabled;
    const artBase = env.R2_PUBLIC_BASE ?? '';
    if (!/^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9./_-]*)?$/i.test(artBase) || artBase.includes('..'))
        return disabled;
    try {
        new URL(artBase);
        const config = JSON.parse(env.AVATAR_MODEL_RESERVATIONS_JSON ?? '{}') as Partial<AdmissionPolicy> | null;
        const policy = { ...config, enabled: true } as AdmissionPolicy;
        if (eligiblePolicy(policy) && policy.providers.length === 2 &&
            policy.providers.every(provider => provider.perAttemptMicros > 0 && provider.limitMicros >= provider.perAttemptMicros * 3))
            return policy;
    } catch {
        // Invalid configuration must not interrupt the model library or expose secret values.
    }
    return disabled;
}
export type ApprovedRead = {
    slug: string; sourceSha256: string; profileSha256?: string; masterSha256: string; pipelineVersion: string;
    kitVersion: string; path: 'A' | 'B'; summary: string; expiresAt: number; revision: number; paintCostume?:true;
    accountId?:string; operation?:string; sheetSha256?:string; privateRefKey?:string;
};
type Budget = { reservedMicros: number; spentMicros: number };
type Receipt = { jobId: string; requestHash: string; accountId:string };
type Save = {character?: {playerModelOwnerId?:string;patreon?: {source?: string; tier?: string}}};
type Refusal = 'disabled' | 'input' | 'entitlement' | 'quota' | 'budget' | 'read-expired' | 'busy';
type Outcome = { jobId: string } | { error: Refusal };

export function validateModelRead(read: ApprovedRead): void {
    if((read.accountId!==undefined && !validModelOwnerId(read.accountId)) ||
        (read.operation!==undefined && !validModelOwnerId(read.operation)) ||
        (read.sheetSha256!==undefined && !/^[a-f0-9]{64}$/.test(read.sheetSha256)))
        throw new Error('Invalid private model provenance');
    if (![read.sourceSha256,read.masterSha256].every(v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v))
        || (read.profileSha256 !== undefined && !/^[a-f0-9]{64}$/.test(read.profileSha256))
        || !['A','B'].includes(read.path) || typeof read.slug!=='string' || !read.slug.length || read.slug.length>128
        || ![read.kitVersion,read.pipelineVersion].every(v=>typeof v==='string' && v.length>0 && v.length<=128)
        || !Number.isSafeInteger(read.expiresAt) || read.expiresAt <= Date.now() || read.expiresAt > Date.now()+15*60_000
        || !Number.isSafeInteger(read.revision) || read.revision<0 || typeof read.summary!=='string' || !read.summary.trim() || read.summary.length>1000)
        throw new Error('Invalid completed portrait read');
}

/** Called only after the private object store and moderated reader have sealed both inputs. */
export async function issueModelRead(read: ApprovedRead): Promise<string> {
    validateModelRead(read);
    if(!read.accountId) {
        const identity=await ensureModelOwner(read.slug);
        if(!identity.ok) throw new Error('Model account unavailable');
        read={...read,accountId:identity.value.id};
    }
    return withPrivateFileLock(async()=>{
    const guards=await modelOwnerProof(read.slug,read.accountId!);
    const revision=await kv.get<number>(prefix+'revision:'+read.slug);
    if(!guards || (revision??0)!==read.revision) throw new Error('Model account changed');
    const privateRefKey=read.privateRefKey??await declarePrivateRead({...read,accountId:read.accountId!});
    const reference=await kv.get<PrivateReference>(privateRefKey);
    if(reference?.owner!==read.slug || reference.accountId!==read.accountId || reference.state!=='read' ||
        reference.sourceSha256!==read.sourceSha256 || reference.masterSha256!==read.masterSha256)
        throw new Error('Invalid private model reference');
    const token = randomUUID();
    const stored = await kv.compareSetMany?.([...guards,{op:'assert',key:prefix+'revision:'+read.slug,expected:revision},
        {op:'assert',key:privateRefKey,expected:reference},{ op:'cas', key:prefix+'read:'+sha(token), expected:null,
        value:{...read,privateRefKey}, ex:Math.max(1,Math.ceil((read.expiresAt-Date.now())/1000)) }]);
    if (!stored) throw new Error('Unable to issue model read');
    return token;
    });
}

function eligiblePolicy(policy: AdmissionPolicy) {
    return policy.enabled && isRecognitionPolicy(policy.recognition) && Number.isSafeInteger(policy.dailyLimit) && policy.dailyLimit>0
        && Array.isArray(policy.providers) && policy.providers.length>0 && policy.providers.every(p=>p && typeof p==='object')
        && policy.providers.some(p=>p.provider==='modal' && p.perAttemptMicros>0)
        && new Set(policy.providers.map(p=>p.provider)).size===policy.providers.length
        && policy.providers.every(p=>['openai','modal'].includes(p.provider) && typeof p.cycle==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.cycle)
            && Number.isSafeInteger(p.limitMicros) && p.limitMicros>=0 && Number.isSafeInteger(p.perAttemptMicros)
            && p.perAttemptMicros>=0 && Number.isSafeInteger(p.perAttemptMicros*3));
}

/** The caller supplies an authenticated slug and server-owned cost policy. */
export async function admitModelJob(owner: string, token: string, idempotencyKey: string, policy: AdmissionPolicy): Promise<Outcome> {
    if (!/^[a-f0-9-]{36}$/.test(token) || !/^[a-zA-Z0-9_-]{8,80}$/.test(idempotencyKey)) return {error:'input'};
    const idem = prefix+'idem:'+owner+':'+idempotencyKey;
    const requestHash = sha(token);
    const replay = async(r: Receipt):Promise<Outcome> => r.requestHash===requestHash &&
        await modelOwnerProof(owner,r.accountId) ? {jobId:r.jobId} : {error:'input'};
    const transact = async (): Promise<Outcome> => {
        const prior = await kv.get<Receipt>(idem);
        if (prior) return replay(prior);
        if (!eligiblePolicy(policy)) return {error:'disabled'};
        const readKey = prefix+'read:'+requestHash;
        const read = await kv.get<ApprovedRead>(readKey);
        if (!read || read.slug!==owner || read.expiresAt<=Date.now() || !read.accountId || !read.privateRefKey)
            return {error:'read-expired'};
        if (!policy.providers.some(p=>p.provider==='openai' && p.perAttemptMicros>0))
            return {error:'budget'};
        const saveKey = 'save:'+owner;
        const revisionKey = prefix+'revision:'+owner, holdKey = prefix+'failures:'+owner+':'+read.sourceSha256;
        const [save, revision, failures] = await Promise.all([
            kv.get<Save>(saveKey), kv.get<number>(revisionKey),
            kv.get<{count:number}>(holdKey),
        ]);
        if (!canCreatePlayerModel(save?.character)) return {error:'entitlement'};
        const ownerGuards=await modelOwnerProof(owner,read.accountId);
        const reference=await kv.get<PrivateReference>(read.privateRefKey);
        if(!ownerGuards || save?.character?.playerModelOwnerId!==read.accountId || reference?.owner!==owner ||
            reference.accountId!==read.accountId || reference.state!=='read' || reference.expiresAt<=Date.now() ||
            reference.sourceSha256!==read.sourceSha256 || reference.masterSha256!==read.masterSha256)
            return {error:'read-expired'};
        if ((revision??0)!==read.revision || (failures?.count??0)>=3) return {error:'input'};
        const { decoded, guards } = await readSavedPortrait(owner, save?.character);
        if (!decoded || sha(decoded.buf)!==(read.profileSha256 ?? read.sourceSha256)) return {error:'read-expired'};
        const now = new Date(), day = now.toISOString().slice(0,10), month = day.slice(0,7);
        const slot = prefix+'slot:'+owner+':'+month, active = prefix+'active:'+owner;
        const dailyKey = prefix+'daily:'+day, dispatchKey = prefix+'dispatch';
        const [existingSlot, existingActive, daily, dispatch] = await Promise.all([
            kv.get(slot),kv.get(active),kv.get<number>(dailyKey),kv.get<string[]>(dispatchKey),
        ]);
        if (existingSlot || existingActive) return {error:'quota'};
        if (!Number.isSafeInteger(daily??0) || (daily??0)<0 || (daily??0)>=policy.dailyLimit) return {error:'budget'};
        const ops: KvCasOp[] = [];
        const reserved = [];
        for (const p of policy.providers) {
            const key=prefix+'budget:'+p.provider+':'+p.cycle;
            const row=await kv.get<Budget>(key);
            const prev=row??{reservedMicros:0,spentMicros:0};
            const amount=p.perAttemptMicros*3;
            if (![prev.reservedMicros,prev.spentMicros].every(v=>Number.isSafeInteger(v)&&v>=0)
                || prev.spentMicros+prev.reservedMicros+amount>p.limitMicros) return {error:'budget'};
            ops.push({op:'cas',key,expected:row,value:{...prev,reservedMicros:prev.reservedMicros+amount}});
            reserved.push({provider:p.provider,cycle:p.cycle,micros:amount});
        }
        const jobId=randomUUID(), createdAt=now.getTime();
        const job={slug:owner,accountId:read.accountId,privateRefKey:read.privateRefKey,
            monthKey:month,state:'queued',attempt:0,assetId:randomUUID().replaceAll('-',''),createdAt,sourceSha256:read.sourceSha256,
            sourceKey:'avatar-model/private/portraits/'+read.sourceSha256,masterKey:'avatar-model/private/masters/'+read.masterSha256,
            masterSha256:read.masterSha256,path:read.path,summary:read.summary,revision:read.revision,
            kitVersion:read.kitVersion,pipelineVersion:read.pipelineVersion,reserved,
            recognition:{...policy.recognition!,nonce:randomBytes(32).toString('hex')},
            ...(read.paintCostume ? {paintCostume:true} : {}),
            entitlement:{source:save?.character?.patreon?.source??'subscription',tier:save?.character?.patreon?.tier??null}};
        if (read.expiresAt<=Date.now()) return {error:'read-expired'};
        if (!canCreatePlayerModel(save?.character)) return {error:'entitlement'};
        ops.push({op:'assert',key:saveKey,expected:save},...ownerGuards.filter(op=>op.key!==saveKey),...guards,
            {op:'assert',key:revisionKey,expected:revision},{op:'assert',key:holdKey,expected:failures},
            {op:'cas',key:read.privateRefKey,expected:reference,value:{...reference,state:'job',jobId}},
            {op:'delete',key:readKey,expected:read},
            {op:'cas',key:slot,expected:null,value:{jobId,reservedAt:createdAt}},
            {op:'cas',key:active,expected:null,value:jobId},{op:'cas',key:prefix+'job:'+jobId,expected:null,value:job},
            {op:'cas',key:idem,expected:null,value:{jobId,requestHash,accountId:read.accountId},ex:32*86400},
            {op:'cas',key:dailyKey,expected:daily,value:(daily??0)+1},
            {op:'cas',key:dispatchKey,expected:dispatch,value:[...(dispatch??[]),jobId]});
        if (await kv.compareSetMany?.(ops)) return {jobId};
        const committed=await kv.get<Receipt>(idem);
        return committed ? replay(committed) : {error:'busy'};
    };
    return withKvLock(prefix+'admit:'+owner,()=>withKvLock(prefix+'admit:budgets',
        ()=>withPrivateFileLock(transact),{failClosed:true}),{failClosed:true});
}
