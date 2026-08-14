import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { commitManualWarfrontRound } from './_warfront-council.js';
import { WARFRONT_TOKEN_TTL_SECONDS, type SealedManualWarfront } from './warfront-start.js';

/**
 * Append one Manual Warfront Council decision to the server-owned token path.
 * An identical retry is idempotent; a changed accepted round, skipped round, or
 * post-finalization append is rejected. The browser cannot submit a different
 * full history later during reward settlement.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const battleTokenRaw = typeof body.battleToken === 'string' ? body.battleToken.trim() : '';
        const battleToken = /^[A-Za-z0-9]+$/.test(battleTokenRaw) ? battleTokenRaw : '';
        const reportKeyRaw = typeof body.reportKey === 'string' ? body.reportKey.slice(0, 64) : '';
        const reportKey = /^[A-Za-z0-9:_-]+$/.test(reportKeyRaw) ? reportKeyRaw : '';
        if (!playerName || !battleToken || !reportKey) return res.status(400).json({ error: 'A valid Manual Warfront authorization is required.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only commit your own War Council.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'warfront-council', 60, 60_000, identity.name))) return;

        const tokenData = await kv.get<{
            playerName?: string;
            reportKey?: string;
            mode?: string;
            manualWarfront?: SealedManualWarfront;
        }>(`pet:battle-token:${playerName}:${battleToken}`);
        if (!tokenData
            || tokenData.playerName?.toLowerCase() !== playerName.toLowerCase()
            || tokenData.mode !== 'warfront'
            || !tokenData.manualWarfront) {
            return res.status(409).json({ error: 'This Manual Warfront authorization is missing, spent, or expired.', code: 'warfront-authorization-invalid' });
        }
        if (tokenData.reportKey !== reportKey) return res.status(403).json({ error: 'War Council authorization does not match this battle report.' });

        const entry = {
            round: body.round,
            choices: body.choices,
            ...(Object.prototype.hasOwnProperty.call(body, 'stance') ? { stance: body.stance } : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'coachOrder') ? { coachOrder: body.coachOrder } : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'buildPackage') ? { buildPackage: body.buildPackage } : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'objectiveTechnique') ? { objectiveTechnique: body.objectiveTechnique } : {}),
            ...(Object.prototype.hasOwnProperty.call(body, 'counterstrike') ? { counterstrike: body.counterstrike } : {}),
        };
        const result = await commitManualWarfrontRound(
            { playerName, battleToken, reportKey },
            tokenData.manualWarfront,
            entry,
            WARFRONT_TOKEN_TTL_SECONDS,
        );
        if (!result.ok) {
            const status = result.code === 'invalid-choice' || result.code === 'round-order' ? 400 : 409;
            const error = result.code === 'path-conflict'
                ? 'This Council round is already bound to a different decision path.'
                : result.code === 'path-finalized'
                    ? 'This Manual Warfront decision path is already finalized.'
                    : result.code === 'round-order'
                        ? 'War Council rounds must be committed once, in order.'
                        : 'This War Council decision is invalid for the sealed match state.';
            return res.status(status).json({ error, code: `warfront-council-${result.code}` });
        }
        return res.status(200).json({
            ok: true,
            round: Number(body.round),
            committedChoices: result.attempt.choices,
            idempotentReplay: result.idempotent,
        });
    } catch (error) {
        console.error('[pet/warfront-council]', safeLogValue(error));
        return res.status(503).json({ error: 'The War Council could not secure this decision. Retry the same choice.' });
    }
}
