import fs from 'node:fs';
import path from 'node:path';

const TRUSTED_DOWNLOAD_HOSTS = new Set([
    'fal.media',
    'storage.googleapis.com',
]);
const TRUSTED_DOWNLOAD_SUFFIXES = ['.fal.media'];
const TRUSTED_PUBLISH_HOSTS = new Set([
    'shinobijourney.com',
    'www.shinobijourney.com',
    'theravensark.com',
    'www.theravensark.com',
    'fatedreunion.com',
    'www.fatedreunion.com',
]);
const DATA_ARTIFACT = /^data:(image\/(?:png|jpeg|webp)|model\/gltf-binary|application\/octet-stream);base64,([a-z0-9+/=\r\n]+)$/i;

function assertByteLimit(bytes, maxBytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Downloaded artifact is empty.');
    if (bytes.length > maxBytes) throw new Error(`Downloaded artifact exceeds ${maxBytes} bytes.`);
    return bytes;
}

export function trustedDownloadUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('Artifact downloads must use HTTPS.');
    if (url.username || url.password) throw new Error('Artifact download URL must not contain credentials.');
    const host = url.hostname.toLowerCase();
    if (!TRUSTED_DOWNLOAD_HOSTS.has(host) && !TRUSTED_DOWNLOAD_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
        throw new Error(`Untrusted artifact download host: ${host}`);
    }
    return url;
}

export function trustedPublishOrigin(value, env = process.env) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error('Publish target must not contain URL credentials.');
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
    if (local) {
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Local publish target must use HTTP or HTTPS.');
    } else {
        if (url.protocol !== 'https:') throw new Error('Remote publish target must use HTTPS.');
        const configured = new Set(String(env.SHINOBIX_TOOL_ALLOWED_ORIGINS ?? '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
            .map((origin) => new URL(origin).origin));
        if (!TRUSTED_PUBLISH_HOSTS.has(url.hostname.toLowerCase()) && !configured.has(url.origin)) {
            throw new Error(`Untrusted publish target: ${url.origin}`);
        }
    }
    return url.origin;
}

export async function downloadArtifactBytes(value, { maxBytes }) {
    const dataMatch = typeof value === 'string' ? DATA_ARTIFACT.exec(value) : null;
    if (dataMatch) return assertByteLimit(Buffer.from(dataMatch[2], 'base64'), maxBytes);

    const requestedUrl = trustedDownloadUrl(value);
    const response = await fetch(requestedUrl, { signal: AbortSignal.timeout(60_000) });
    trustedDownloadUrl(response.url || requestedUrl.href);
    if (!response.ok) throw new Error(`Artifact download failed with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`Downloaded artifact exceeds ${maxBytes} bytes.`);
    }
    return assertByteLimit(Buffer.from(await response.arrayBuffer()), maxBytes);
}

export function writeTrustedArtifact(root, outputFile, bytes, { extensions, maxBytes }) {
    const safeRoot = path.resolve(root);
    const safeOutput = path.resolve(outputFile);
    const relative = path.relative(safeRoot, safeOutput);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Artifact output must stay inside its configured root.');
    }
    if (!extensions.includes(path.extname(safeOutput).toLowerCase())) {
        throw new Error(`Artifact output extension is not allowed: ${path.extname(safeOutput)}`);
    }
    assertByteLimit(bytes, maxBytes);
    // The response is bounded, its redirect destination is provider-allowlisted,
    // and the destination is extension-checked and confined to the output root.
    // codeql[js/http-to-file-access]
    fs.writeFileSync(safeOutput, bytes); // lgtm[js/http-to-file-access]
}
