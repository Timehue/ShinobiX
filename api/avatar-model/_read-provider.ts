import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';

export async function moderateModelPortrait(raw: Buffer): Promise<string | null> {
    const key = process.env.AVATAR_MODEL_OPENAI_API_KEY;
    if (!key) throw new Error('Missing image moderation configuration');
    let frame: Buffer, frameHash: string;
    try {
        const opts = { limitInputPixels: 16_000_000, failOn: 'error' as const };
        const meta = await sharp(raw, opts).metadata();
        const pages = meta.pages ?? 1;
        if (!['jpeg', 'png', 'gif', 'webp'].includes(meta.format ?? '') || pages > 500 ||
            Math.min(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0) < 16) return null;
        // The sprite reader uses the middle frame, including for animated uploads.
        const view = sharp(raw, { ...opts, page: Math.floor(pages / 2), pages: 1 }).autoOrient().toColourspace('srgb').ensureAlpha();
        const raster = await view.clone().raw().toBuffer({resolveWithObject:true});
        frameHash = createHash('sha256').update(raster.info.width + 'x' + raster.info.height + ':').update(raster.data).digest('hex');
        frame = await view.resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch {
        return null;
    }
    const response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest',
            input: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + frame.toString('base64') } }] }),
        signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Image moderation unavailable');
    const result = await response.json();
    if (result.results?.length !== 1 || typeof result.results[0]?.flagged !== 'boolean')
        throw new Error('Invalid image moderation response');
    return result.results[0].flagged ? null : frameHash;
}

export function modelModalEnvironment(): NodeJS.ProcessEnv {
    const { AVATAR_MODEL_MODAL_TOKEN_ID: id, AVATAR_MODEL_MODAL_TOKEN_SECRET: secret } = process.env;
    if (!id?.trim() && !secret?.trim()) return process.env;
    if (!id?.trim() || !secret?.trim()) throw new Error('Incomplete avatar worker credentials');
    const env: NodeJS.ProcessEnv = { ...process.env, MODAL_TOKEN_ID: id, MODAL_TOKEN_SECRET: secret };
    for (const name of ['MODAL_OAUTH_REFRESH_TOKEN', 'MODAL_OAUTH_CLIENT_ID', 'MODAL_OAUTH_CLIENT_SECRET', 'MODAL_OAUTH_JWT_KEY'])
        delete env[name];
    return env;
}

export type ReadReply = { status: 'pending' | 'declined' | 'failed' } | {
    status: 'accepted'; receipt: { sourceSha256: string; fittedMasterSha256: string; sheetSha256: string; style: string; declined: null };
    descriptor: string; sheet: string; pipelineVersion: string; paintedCostumes?:boolean; paintedTemplate?:string;
};
export async function runModelRead(operation: string, sourceSha256: string, raw: Buffer, frameHash: string): Promise<ReadReply> {
    const python = process.env.AVATAR_MODEL_MODAL_PYTHON;
    if (!python) throw new Error('Missing portrait reader');
    return new Promise((accept, reject) => {
        const child = spawn(python, [resolve('workers/avatar-model/dispatch_read.py')], {
            stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, timeout: 30_000,
            env: modelModalEnvironment(),
        });
        const chunks: Buffer[] = [];
        let bytes = 0;
        child.on('error', reject);
        child.stdin.on('error', reject);
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes <= 23 * 1024 ** 2) chunks.push(chunk);
            else child.kill();
        });
        child.on('close', code => {
            if (code !== 0 || bytes > 23 * 1024 ** 2) return reject(new Error('Portrait reader unavailable'));
            try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new Error('Malformed portrait read')); }
        });
        child.stdin.end(JSON.stringify({ operation, sourceSha256, frameHash, portrait: raw.toString('base64') }));
    });
}
