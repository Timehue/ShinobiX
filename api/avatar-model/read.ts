import { createHash, randomUUID } from 'node:crypto';
import { authedPlayer } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { readSavedPortrait } from './_saved-portrait.js';
import { matchingProfileDetail } from './_profile-detail.js';
import { canCreatePlayerModel, modelCreationPolicy, playerPortraitChecksEnabled } from './_admission.js';
import { paintedTemplates, sealModelRead } from './_private-files.js';
import { moderateModelPortrait, runModelRead } from './_read-provider.js';
import { ensureModelOwner, modelOwnerProof } from './_owner.js';

const prefix = 'avatar-model:';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const descriptions = new Map(Object.entries({
    tied: 'Masked warrior with tied hair', short: 'Masked warrior with short hair',
    'raccoon-feathered-coat': 'Upright raccoon in a feathered coat',
    'masked-pointed-ear-collar': 'Pointed-ear warrior with a mask and collar',
    'field-coat-and-vials': 'Field medic in a coat with vials', 'crested-guard': 'Guard with a crested headpiece',
    'open-robe-and-eye-cover': 'Warrior with an eye covering and open robe', 'hooded-jacket': 'Warrior in a hooded jacket',
    'exposed-hair-full-figure': 'Standing warrior with uncovered hair', 'hooded-full-figure': 'Standing hooded warrior',
    'portrait-bust-coat': 'Clothed human character',
    'armored-raccoon': 'Armored raccoon character',
}));
type ReadRow = { operation: string; stage: 'moderate' | 'read' | 'declined' | 'failed' | 'ready';
    readToken?: string; summary?: string; frameHash?: string; expiresAt: number };
const providers = { moderate: moderateModelPortrait, read: runModelRead, seal: sealModelRead };

export async function checkPlayerPortrait(owner: string, ports = providers) {
    const daily = Number(process.env.AVATAR_MODEL_READ_DAILY_LIMIT);
    const perOwner = Number(process.env.AVATAR_MODEL_READ_PLAYER_DAILY_LIMIT);
    if (!playerPortraitChecksEnabled()) return { error: 'disabled' } as const;
    const day = new Date().toISOString().slice(0, 10);
    const slot = prefix + 'slot:' + owner + ':' + day.slice(0, 7), active = prefix + 'active:' + owner;
    const saveKey = 'save:' + owner, revisionKey = prefix + 'revision:' + owner;
    const [save, revision, monthSlot, activeJob] = await Promise.all([
        kv.get<{ character?: unknown }>(saveKey), kv.get<number>(revisionKey), kv.get(slot), kv.get(active),
    ]);
    if (!canCreatePlayerModel(save?.character)) return { error: 'entitlement' } as const;
    if (monthSlot || activeJob) return { error: 'quota' } as const;
    const identity=await ensureModelOwner(owner);
    if(!identity.ok) return {error:'unavailable'} as const;
    const accountId=identity.value.id;
    const { decoded, guards } = await readSavedPortrait(owner, identity.character);
    if (!decoded || decoded.buf.length > 3 * 1024 ** 2) return { state: 'declined' } as const;
    const thumbnail = hash(decoded.buf);
    const detail = await matchingProfileDetail(owner,thumbnail);
    const bytes = detail ?? decoded.buf;
    const source = detail ? hash(bytes) : thumbnail;
    const rowKey = prefix + 'screen:' + owner + ':' + accountId + ':' + (revision ?? 0) + ':' + source + (detail ? ':' + thumbnail : '');
    const persist = async (prior: ReadRow, next: ReadRow) => {
        const ownerGuards=await modelOwnerProof(owner,accountId);
        if (!ownerGuards || !await kv.compareSetMany?.([...ownerGuards,
            {op:'assert',key:revisionKey,expected:revision},{ op: 'cas', key: rowKey, expected: prior, value: next,
            ex: Math.max(1, Math.ceil((next.expiresAt - Date.now()) / 1000)) }])) throw new Error('Portrait read changed');
        return next;
    };
    let row = await kv.get<ReadRow>(rowKey);
    if (!row || row.expiresAt <= Date.now()) {
        const globalKey = prefix + 'read-day:' + day, ownerKey = globalKey + ':' + owner + ':' + accountId;
        const [all, own, held] = await Promise.all([kv.get<number>(globalKey), kv.get<number>(ownerKey),
            kv.get<{ count: number }>(prefix + 'failures:' + owner + ':' + source)]);
        if ((held?.count ?? 0) >= 3) return { state: 'declined' } as const;
        if (![own ?? 0, all ?? 0].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error('Invalid read counters');
        if ((own ?? 0) >= perOwner || (all ?? 0) >= daily) return { error: 'limit' } as const;
        const next: ReadRow = { operation: randomUUID(), stage: 'moderate', expiresAt: Date.now() + 15 * 60_000 };
        const ownerGuards=await modelOwnerProof(owner,accountId);
        if(!ownerGuards) return {error:'unavailable'} as const;
        const won = await kv.compareSetMany?.([
            ...ownerGuards, { op: 'assert', key: revisionKey, expected: revision },
            ...guards, { op: 'assert', key: slot, expected: null },
            { op: 'assert', key: active, expected: null }, { op: 'cas', key: rowKey, expected: row, value: next, ex: 900 },
            { op: 'cas', key: globalKey, expected: all, value: (all ?? 0) + 1, ex: 172800 },
            { op: 'cas', key: ownerKey, expected: own, value: (own ?? 0) + 1, ex: 172800 },
        ]);
        if (!won) return { state: 'pending' } as const;
        row = next;
    }
    if (row.stage === 'moderate') {
        const frameHash = await ports.moderate(bytes);
        row = await persist(row, frameHash ? { ...row, stage: 'read', frameHash } : { ...row, stage: 'declined' });
    }
    if (row.stage === 'read') {
        if (!row.frameHash || !/^[a-f0-9]{64}$/.test(row.frameHash)) throw new Error('Missing moderated frame');
        const result = await ports.read(row.operation, source, bytes, row.frameHash);
        if (result.status === 'pending') return { state: 'pending' } as const;
        if (result.status === 'accepted') {
            const { receipt } = result;
            const summary = descriptions.get(receipt.style);
            const descriptor = Buffer.from(result.descriptor, 'base64'), sheet = Buffer.from(result.sheet, 'base64');
            const fit = JSON.parse(descriptor.toString('utf8'));
            if (!summary || receipt.declined !== null || receipt.sourceSha256 !== source ||
                hash(sheet) !== receipt.sheetSha256 || fit.fit?.style !== receipt.style ||
                !/^[a-f0-9]{64}$/.test(result.pipelineVersion)) throw new Error('Invalid portrait classification');
            const expiresAt = Date.now() + 10 * 60_000;
            const paintCostume=process.env.AVATAR_MODEL_PAINTED_COSTUMES_ENABLED==='1' && !fit.fit.paintingSha256 &&
                paintedTemplates.has(fit.fit.template);
            if (fit.fit.requiresPainting === true && !paintCostume) throw new Error('Close-up painting unavailable');
            if (paintCostume) {
                // Earlier painted workers advertised the two coat rigs together.
                const supported = result.paintedTemplate === undefined
                    ? ['male-coat-template.json','female-coat-template.json']
                    : [result.paintedTemplate];
                if (result.paintedCostumes !== true || !supported.includes(fit.fit.template))
                    throw new Error('Costume worker release unavailable');
            }
            const token = await ports.seal({ slug: owner, sourceSha256: source, masterSha256: receipt.fittedMasterSha256,
                accountId,operation:row.operation,sheetSha256:receipt.sheetSha256,
                expiresAt, revision: revision ?? 0, path: 'A', summary, kitVersion: fit.templateSha256,
                pipelineVersion: result.pipelineVersion, ...(detail ? {profileSha256:thumbnail} : {}),
                ...(paintCostume ? {paintCostume:true} : {}) }, bytes, descriptor, sheet);
            row = await persist(row, { ...row, stage: 'ready', summary, readToken: token, expiresAt });
        } else if (result.status === 'declined' || result.status === 'failed') {
            row = await persist(row, { ...row, stage: result.status });
        } else throw new Error('Invalid reader state');
    }
    if (row.stage === 'ready') return { state: 'ready', path: 'A', summary: row.summary, readToken: row.readToken } as const;
    return row.stage === 'declined' ? { state: 'declined' } as const : { error: 'unavailable' } as const;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const owner = await authedPlayer(req);
        if (!owner) return res.status(401).json({ error: 'auth' });
        if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))
            return res.status(400).json({ error: 'input' });
        if (!modelCreationPolicy().enabled) return res.status(503).json({ error: 'disabled' });
        if (!await enforceRateLimitKv(req, res, 'avatar-model-screen', 24, 60_000, owner)) return;
        const result = await withKvLock(prefix + 'screen-owner:' + owner, () => checkPlayerPortrait(owner),
            { ttlSec: 180, failClosed: true });
        if (result.error) return res.status(({ entitlement: 403, quota: 409, limit: 429, disabled: 503, busy: 503, unavailable: 503 })[result.error]).json(result);
        return res.status(result.state === 'pending' ? 202 : 200).json(result);
    } catch { return res.status(503).json({ error: 'unavailable' }); }
}
