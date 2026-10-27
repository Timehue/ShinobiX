import { randomBytes } from 'node:crypto';

/** Use the server's current name rules without weakening registration. */
export function createSoakName(index, moderation, suffix = () => randomBytes(3).toString('hex')) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const name = `soak${suffix()}${index}`;
        if (name.length <= moderation.TEXT_LIMITS.playerName
            && moderation.isCleanPlayerName(name)
            && !moderation.hasStaffImpersonationName(name)) return name;
    }
    throw new Error('Could not generate an allowed soak account name after 64 candidates.');
}

/** Deliberately excludes names, passwords, tokens, response bodies and errors. */
export function setupFailureDiagnostic({ player, phase, attempt, status, reason }) {
    const safePhase = ['name-generation', 'register', 'initial-save'].includes(phase) ? phase : 'setup';
    const safeReason = ['rejected', 'missing-token', 'exception'].includes(reason) ? reason : 'rejected';
    const safeNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'none';
    return `[soak setup] player=${safeNumber(player)} phase=${safePhase} attempt=${safeNumber(attempt)} status=${safeStatus} reason=${safeReason}`;
}
