import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { withScheduledJobLease } from '../cron/_job-lease.js';
import { isPlayerModel, type PlayerModel } from '../../shared/player-model-ref.js';
import type { ModelRetryCause } from '../../shared/avatar-model-operations.js';
import type { AdmissionPolicy, ProviderReservation } from './_admission.js';
import { readPrivateModelFile, storePaintedFit, validatePaintedFit } from './_private-files.js';
import { modelModalEnvironment, moderateModelPortrait } from './_read-provider.js';
import { endModelJob } from './_settlement.js';
import { modelOwnerProof } from './_owner.js';
import { isRecognitionPolicy, validRecognition, type RecognitionOperation, type RecognitionReceipt } from './_recognition.js';

const styles = ['A','B','C'] as const;
type Style = typeof styles[number];
type Stage = Style | 'finish' | 'paint' | 'recognize';
type DispatchJob = {
    slug:string; monthKey:string; state:string; attempt:number; assetId:string; revision:number;
    accountId:string; privateRefKey:string;
    sourceSha256:string; masterSha256:string; movement?:string; callId?:string; unknownSince?:number;
    paintCostume?:true; originalMasterSha256?:string; checkedPainting?:string; kitVersion?:string; masterKey?:string;
    completed?:Partial<Record<Style,string>>; finishedCall?:string; delivery?:StageReply['model']; publishingAt?:number;
    providerCalls?: Record<string,string>;
    erasedAt?:number;
    retryCauses?: Partial<Record<ModelRetryCause, number>>;
    recognition?:RecognitionOperation; recognitionReceipt?:RecognitionReceipt;
    reserved:Array<{provider:string; cycle:string; micros:number}>;
};
type StageRequest = Pick<DispatchJob,'attempt'|'assetId'|'sourceSha256'|'masterSha256'|'movement'|'completed'|'callId'> &
    {stage:Stage|'publish'; descriptor?:string; sheet?:string; portrait?:string; model?:StageReply['model'];
        recognition?:RecognitionOperation; finishedCall?:string};
type StageReply = {status:'unknown'|'pending'|'failed'|'complete'|'lost-style'|'invalid-art'; callId?:string; movement?:string;
    model?:PlayerModel & {objects:number; bytes:number}; descriptor?:string; sheet?:string; lostStyle?:string;
    recognitionReceipt?:RecognitionReceipt};
const prefix = 'avatar-model:';
const callIdPattern = /^fc-[A-Za-z0-9]{1,100}$/;
// Allow the longest style invocation to finish and its started call to become discoverable.
const unknownSubmissionGraceMs = 6 * 60 * 60_000;

function retryJob(job: DispatchJob, cause: ModelRetryCause): DispatchJob {
    const next = { ...job, attempt: job.attempt + 1,
        retryCauses: { ...job.retryCauses, [cause]: (job.retryCauses?.[cause] ?? 0) + 1 } };
    delete next.callId;
    return next;
}

async function modalStage(request:StageRequest):Promise<StageReply> {
    const python = process.env.AVATAR_MODEL_MODAL_PYTHON;
    if (!python) throw new Error('Modal interpreter unavailable');
    return new Promise((accept,reject) => {
        const child = spawn(python,[resolve('workers/avatar-model/dispatch_stage.py')],{
            stdio:['pipe','pipe','ignore'], windowsHide:true, timeout:request.stage==='publish' ? 12*60_000 : 120_000,
            env: modelModalEnvironment(),
        });
        const limit=request.stage==='paint' ? 23*1024**2 : 4096;
        let output='';
        child.on('error',reject);
        child.stdin.on('error',reject);
        child.stdout.setEncoding('utf8').on('data',(chunk:string) => {
            output+=chunk;
            if (output.length>limit) child.kill();
        });
        child.on('close',code => {
            if (code!==0 || output.length>limit) return reject(new Error('Worker status unavailable'));
            try { accept(JSON.parse(output)); } catch { reject(new Error('Invalid worker response')); }
        });
        child.stdin.end(JSON.stringify(request));
    });
}

async function covered(job:DispatchJob, providers:ProviderReservation[]) {
    if (!providers.some(p => p.provider==='modal') || !job.reserved?.length) return false;
    for (const reservation of job.reserved) {
        const policy = providers.find(p => p.provider===reservation.provider && p.cycle===reservation.cycle);
        const row = await kv.get<{reservedMicros:number; spentMicros:number}>(prefix+'budget:'+reservation.provider+':'+reservation.cycle);
        if (!policy || !row || !Number.isSafeInteger(policy.limitMicros) || !Number.isSafeInteger(reservation.micros) ||
            reservation.micros<0 || !Number.isSafeInteger(row.reservedMicros) || row.reservedMicros<reservation.micros ||
            !Number.isSafeInteger(row.spentMicros) || row.spentMicros<0 || row.spentMicros+row.reservedMicros>policy.limitMicros)
            return false;
    }
    return job.reserved.some(p=>p.provider==='modal' && p.micros>0);
}

/** Advance one durable stage. A timeout keeps the same asset, attempt and provider operation key. */
export async function advanceSpriteJob(id:string, policy:AdmissionPolicy, run=modalStage, read=readPrivateModelFile,
    painting={moderate:moderateModelPortrait,store:storePaintedFit}) {
    const key=prefix+'job:'+id;
    const initial=await kv.get<DispatchJob>(key);
    if (!initial || initial.recognitionReceipt?.passed || !['queued','render','validate'].includes(initial.state)) return;
    const ownerGuards=await modelOwnerProof(initial.slug,initial.accountId);
    if(!ownerGuards) return;
    let job:DispatchJob=initial;
    const active={op:'assert' as const,key:prefix+'active:'+job.slug,expected:id};
    const revKey=prefix+'revision:'+job.slug;
    const revision=await kv.get<number>(revKey);
    if ((revision??0)!==job.revision || await kv.get(active.key)!==id) return;
    const guard={op:'assert' as const,key:revKey,expected:revision};
    // The kill switch (or creation turned off) PAUSES the queue. The job keeps its slot, reservations
    // and provider call ID, and the next tick after the switch is cleared resumes it where it stopped.
    if (!policy.enabled) return;
    if (!await covered(job,policy.providers)) {
        await endModelJob(id,job.slug,'generation-disabled',job);
        return;
    }
    if (job.state==='queued') {
        const claimed={...job,state:'render',attempt:1};
        if (!await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:claimed}])) return;
        job=claimed;
    }
    const needsPaint=job.paintCostume && !job.originalMasterSha256;
    if (needsPaint && (!job.reserved.some(p=>p.provider==='openai' && p.micros>0) ||
        !job.kitVersion || !/^[a-f0-9]{64}$/.test(job.kitVersion))) {
        await endModelJob(id,job.slug,'generation-disabled',job);
        return;
    }
    const stage=job.finishedCall ? 'recognize' : needsPaint ? 'paint' : styles.find(style=>!job.completed?.[style])??'finish';
    if (stage==='recognize' && (!job.delivery || !isRecognitionPolicy(job.recognition) ||
        !/^[a-f0-9]{64}$/.test(job.recognition.nonce) || !job.reserved.some(p=>p.provider==='openai' && p.micros>0))) {
        await endModelJob(id,job.slug,'generation-disabled',job); return;
    }
    const request:StageRequest = {stage, assetId:job.assetId, sourceSha256:job.sourceSha256,
        masterSha256:job.masterSha256, attempt:job.attempt, movement:job.movement, completed:job.completed, callId:job.callId,
        ...(stage==='recognize' ? {recognition:job.recognition,finishedCall:job.finishedCall,model:job.delivery} : {})};
    if (!job.callId) {
        const descriptor=await read('masters',job.masterSha256);
        const master=JSON.parse(descriptor.toString('utf8'));
        if (master.fit?.sourceSha256!==job.sourceSha256) throw new Error('Invalid job artwork');
        request.descriptor=descriptor.toString('base64');
        if (stage==='paint' || stage==='recognize') request.portrait=(await read('portraits',job.sourceSha256)).toString('base64');
        else if (stage!=='finish') request.sheet=(await read('sheets',master.fit.sheetSha256)).toString('base64');
    }
    const result=await run(request);
    if (stage==='recognize' && result.callId && callIdPattern.test(result.callId) &&
        (!job.callId || result.callId===job.callId) && validRecognition(result.recognitionReceipt,job,false)) {
        const ended=await kv.get<DispatchJob>(key);
        if (ended?.assetId===job.assetId && ['cancelled','failed'].includes(ended.state)) {
            if (ended.erasedAt!==undefined) return; // Erased account records cannot regain portrait evidence.
            // A cancellation can win while the paid review is running. Retain both billing identities.
            if (!await kv.compareSetMany?.([{op:'cas',key,expected:ended,value:{...ended,
                providerCalls:{...ended.providerCalls,['recognize/'+job.attempt]:result.callId},
                recognitionReceipt:result.recognitionReceipt}}])) throw new Error('Late recognition receipt could not be recorded');
            return;
        }
    }
    if (result.status==='unknown') {
        if (job.callId) throw new Error('Lost acknowledged call identity');
        if (job.unknownSince===undefined) {
            await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:{...job,unknownSince:Date.now()}}]);
        } else if (Date.now()-job.unknownSince>=unknownSubmissionGraceMs) {
            await endModelJob(id,job.slug,'provider-outage',job);
        }
        return;
    }
    const missing = result.lostStyle ?? result.callId;
    const lost = result.status==='lost-style' ? styles.filter(style=>job.completed?.[style]===missing) : [];
    if (result.status==='lost-style') {
        const trustedCall=result.lostStyle ? (!job.callId || result.callId===job.callId) && result.callId!==missing : !job.callId;
        if (stage!=='finish' || !trustedCall || !result.callId || !callIdPattern.test(result.callId)
            || !missing || !callIdPattern.test(missing) || lost.length!==1)
            throw new Error('Invalid missing style receipt');
    }
    // Old workers could report a lost style before starting the assembly call.
    const reportedExistingStyle = result.status==='lost-style' && !result.lostStyle;
    if (!reportedExistingStyle) {
        if (!result.callId || !callIdPattern.test(result.callId) || (job.callId && job.callId!==result.callId))
            throw new Error('Invalid provider call receipt');
        const operation = stage+'/'+job.attempt;
        const recorded = job.providerCalls?.[operation];
        if (recorded && recorded!==result.callId) throw new Error('Conflicting provider operation');
        if (!recorded) {
            const updated={...job,providerCalls:{...job.providerCalls,[operation]:result.callId}};
            if (!await kv.compareSetMany?.([{op:'cas',key,expected:job,value:updated}])) {
                // Cancellation can win during spawn. Keep its outcome and attach the late billing ID.
                const ended=await kv.get<DispatchJob>(key);
                if (ended?.assetId===job.assetId && ended.erasedAt===undefined &&
                    ['cancelled','failed'].includes(ended.state) && !ended.providerCalls?.[operation]) {
                    if (!await kv.compareSetMany?.([{op:'cas',key,expected:ended,value:{...ended,
                        providerCalls:{...ended.providerCalls,[operation]:result.callId}}}]))
                        throw new Error('Late provider receipt could not be recorded');
                }
                return;
            }
            job=updated;
        }
    }
    if (result.status==='lost-style') {
        if (job.attempt>=3) { await endModelJob(id,job.slug,'provider-outage',job); return; }
        const completed={...job.completed};
        delete completed[lost[0]];
        const retry={...retryJob(job,'expired-style'),completed};
        delete retry.unknownSince;
        await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:retry}]);
        return;
    }
    if (stage==='paint' && (result.status==='invalid-art' ||
        (result.status==='complete' && (!result.descriptor || !result.sheet)))) {
        await endModelJob(id,job.slug,'output-validation',job);
        return;
    }
    let next:DispatchJob={...job,callId:result.callId};
    if (result.status==='pending' && result.callId===job.callId) return;
    if (result.status==='complete') {
        if (stage==='paint') {
            const sheet=Buffer.from(result.sheet!,'base64'), descriptor=Buffer.from(result.descriptor!,'base64');
            try { validatePaintedFit(job.sourceSha256,job.kitVersion!,descriptor,sheet); }
            catch { await endModelJob(id,job.slug,'output-validation',job); return; }
            const digest=createHash('sha256').update(descriptor).digest('hex');
            if (job.checkedPainting && job.checkedPainting!==digest) {
                await endModelJob(id,job.slug,'output-validation',job); return;
            }
            if (!job.checkedPainting) {
                if (!await painting.moderate(sheet)) { await endModelJob(id,job.slug,'output-validation',job); return; }
                const checked={...job,checkedPainting:digest,callId:result.callId};
                delete checked.unknownSince;
                if (!await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:checked}])) return;
                job=checked;
            }
            const master=await painting.store(descriptor,sheet,{owner:job.slug,accountId:job.accountId,
                jobId:id,referenceKey:job.privateRefKey,revision:job.revision});
            next={...job,originalMasterSha256:job.masterSha256,masterSha256:master,
                masterKey:'avatar-model/private/masters/'+master};
        } else if (stage==='recognize') {
            if (!validRecognition(result.recognitionReceipt,job,false)) {
                await endModelJob(id,job.slug,'output-validation',job); return;
            }
            next={...job,recognitionReceipt:result.recognitionReceipt};
            if (!result.recognitionReceipt.passed) {
                // Keep the exact rejected verdict and its provider usage when returning the monthly slot.
                if (await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:next}]))
                    await endModelJob(id,job.slug,'output-validation',next);
                return;
            }
        } else if (stage==='finish') {
            if (!isPlayerModel(result.model) || result.model.assetId!==job.assetId ||
                !Number.isSafeInteger(result.model.bytes) || result.model.bytes<=0 || result.model.bytes>8*1024**2 ||
                !Number.isSafeInteger(result.model.objects) || result.model.objects<=0) throw new Error('Invalid finished sprite receipt');
            next={...next,state:'validate',finishedCall:result.callId,delivery:result.model};
        } else {
            if (!result.movement || !/^[a-f0-9]{64}$/.test(result.movement) ||
                (job.movement && job.movement!==result.movement)) throw new Error('Invalid movement revision');
            next={...job,movement:result.movement,completed:{...job.completed,[stage]:result.callId}};
        }
        delete next.callId;
    } else if (result.status==='failed') {
        if (stage==='paint' || stage==='recognize' || job.attempt>=3) { await endModelJob(id,job.slug,'provider-outage',job); return; }
        next=retryJob(job,'worker-failure');
    } else if (result.status!=='pending') throw new Error('Unknown worker state');
    delete next.unknownSince;
    if (validRecognition(next.recognitionReceipt,next)) {
        const dispatchKey=prefix+'dispatch', publishKey=prefix+'publish';
        const [dispatch,publish]=await Promise.all([kv.get<string[]>(dispatchKey),kv.get<string[]>(publishKey)]);
        if (!dispatch?.includes(id)) return;
        await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:next},
            {op:'cas',key:dispatchKey,expected:dispatch,value:dispatch.filter(item=>item!==id)},
            {op:'cas',key:publishKey,expected:publish,value:[...(publish??[]),id]}]);
    } else {
        await kv.compareSetMany?.([...ownerGuards,active,guard,{op:'cas',key,expected:job,value:next}]);
    }
}

/** The validated revision is the publication decision. Replays complete the same asset. */
export async function publishSpriteJob(id:string, run=modalStage) {
    const key=prefix+'job:'+id;
    const initial=await kv.get<DispatchJob>(key);
    if (initial?.state!=='validate' || !initial.finishedCall || !initial.delivery) return;
    if (!validRecognition(initial.recognitionReceipt,initial)) {
        await endModelJob(id,initial.slug,'output-validation',initial); return;
    }
    // No provider billing occurs here. The worker can recover a completed upload from R2 alone.
    const ownerGuards=await modelOwnerProof(initial.slug,initial.accountId);
    if(!ownerGuards) return;
    let job=initial;
    const activeKey=prefix+'active:'+job.slug, slotKey=prefix+'slot:'+job.slug+':'+job.monthKey;
    const revisionKey=prefix+'revision:'+job.slug, assetKey=prefix+'asset:'+job.assetId;
    const [slot,revision]=await Promise.all([kv.get<{jobId:string;reservedAt:number}>(slotKey),kv.get<number>(revisionKey)]);
    if (slot?.jobId!==id || (revision??0)!==job.revision || await kv.get(activeKey)!==id) return;
    const guard={op:'assert' as const,key:revisionKey,expected:revision};
    if (!job.publishingAt) {
        // Paused, not ended: the paid output stays in validate and publishes once the switch is cleared.
        if (process.env.AVATAR_MODEL_KILL_SWITCH==='1') return;
        const decision={...job,publishingAt:Date.now()};
        if (!await kv.compareSetMany?.([...ownerGuards,guard,{op:'assert',key:activeKey,expected:id},{op:'assert',key:slotKey,expected:slot},
            {op:'assert',key:assetKey,expected:null},{op:'cas',key,expected:job,value:decision}])) return;
        job=decision;
    }
    const model=initial.delivery;
    const reply=await run({stage:'publish',attempt:job.attempt,assetId:job.assetId,masterSha256:job.masterSha256,
        sourceSha256:job.sourceSha256,callId:initial.finishedCall,model});
    if (reply.callId!==initial.finishedCall) throw new Error('Invalid publication call');
    if (reply.status==='failed') { await endModelJob(id,job.slug,'provider-outage',job); return; }
    if (reply.status!=='complete' || !reply.model || reply.model.version!==model.version ||
        reply.model.assetId!==job.assetId || reply.model.bytes!==model.bytes || reply.model.objects!==model.objects)
        throw new Error('Unverified sprite publication');
    await withKvLock(prefix+'admit:'+job.slug,async()=>{
        const queueKey=prefix+'publish', queue=await kv.get<string[]>(queueKey);
        if (!queue?.includes(id)) return;
        const now=Date.now();
        await kv.compareSetMany?.([...ownerGuards,guard,{op:'delete',key:activeKey,expected:id},
            {op:'cas',key:slotKey,expected:slot,value:{...slot,usedAt:now}},
            {op:'cas',key:assetKey,expected:null,value:{...model,owner:job.slug,jobId:id,status:'ready',
                accountId:job.accountId,privateRefKey:job.privateRefKey,
                sourceSha256:job.sourceSha256,masterSha256:job.masterSha256,readyAt:now}},
            {op:'cas',key,expected:job,value:{...job,state:'ready',endedAt:now}},
            {op:'cas',key:queueKey,expected:queue,value:queue.filter(item=>item!==id)}]);
    },{failClosed:true});
}

export async function tickSpriteDispatch() {
    if (process.env.AVATAR_MODEL_DISPATCH_ENABLED!=='1' || !process.env.AVATAR_MODEL_MODAL_PYTHON ||
        !process.env.AVATAR_MODEL_MODAL_ENVIRONMENT) return;
    await withScheduledJobLease('avatar-model-dispatch', async () => {
        const jobs=await kv.get<string[]>(prefix+'dispatch');
        const config=JSON.parse(process.env.AVATAR_MODEL_RESERVATIONS_JSON??'{}') as AdmissionPolicy;
        const policy={...config,enabled:process.env.AVATAR_MODEL_CREATION_ENABLED==='1' &&
            process.env.AVATAR_MODEL_KILL_SWITCH!=='1'};
        for (const id of jobs??[]) {
            try { await withScheduledJobLease('avatar-model-job:'+id,()=>advanceSpriteJob(id,policy),{ttlSec:240}); }
            catch { console.warn('[avatar-model] Unable to advance private job',id); }
        }
        for (const id of await kv.get<string[]>(prefix+'publish')??[]) {
            try { await withScheduledJobLease('avatar-model-publish:'+id,()=>publishSpriteJob(id),{ttlSec:900}); }
            catch { console.warn('[avatar-model] Unable to verify sprite publication',id); }
        }
    },{ttlSec:300});
}
