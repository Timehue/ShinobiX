import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const runtime = globalThis as typeof globalThis & { __shinobiDevSessionSecret?: Buffer };
const devSessionSecret = runtime.__shinobiDevSessionSecret ??= randomBytes(32);

function safeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
}

function signatureFor(unsignedToken: string, secret: Buffer): Buffer {
    return createHmac('sha256', secret).update(unsignedToken).digest();
}

/** Signed, process-local token that survives Vite config hot reloads. */
export function issueSignedDevSessionToken(playerId: string, secret: Buffer = devSessionSecret): string {
    const canonical = safeName(playerId);
    if (!canonical) throw new Error('Cannot issue a dev token without a player id.');
    const payload = Buffer.from(canonical).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const unsigned = `dev.${payload}.${nonce}`;
    const signature = signatureFor(unsigned, secret).toString('base64url');
    return `${unsigned}.${signature}`;
}

export function verifySignedDevSessionToken(
    token: string,
    claimedName: string,
    secret: Buffer = devSessionSecret,
): string | null {
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'dev' || parts[2].length !== 43 || !parts[3]) return null;
    try {
        const tokenName = safeName(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!tokenName || tokenName !== safeName(claimedName)) return null;
        const expected = signatureFor(parts.slice(0, 3).join('.'), secret);
        const supplied = Buffer.from(parts[3], 'base64url');
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
        return tokenName;
    } catch {
        return null;
    }
}
