import { safeLogValue } from '../_safe-log.js';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { applySoloPveUsageCosts, withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { applyAiFightOutcomeToCharacter } from '../missions/_ai-fight-outcome.js';
import { cashOutEndless, recordEndlessWin, startEndlessRun, type EndlessRun } from './_run.js';
import {
    endlessWaveBindingKey,
    endlessWaveVitals,
    settleEndlessWaveBinding,
    validateTerminalEndlessWave,
    ENDLESS_WAVE_TTL_SECONDS,
    type EndlessWaveBinding,
} from './_wave-session.js';

const cleanToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value) ? value : '';
const cleanWaveRunId = (value: unknown) => typeof value === 'string' && /^endlesswave-[a-f0-9]{32}$/.test(value) ? value : '';
const dayKey = () => new Date().toISOString().slice(0, 10);

type EndlessReceipt = {
    key: string;
    action: 'settle' | 'cashout' | 'abandon';
    outcome?: 'win' | 'loss' | 'fled' | 'draw';
    reward?: { ryo: number; xp: number };
    milestone?: { boneCharms: number; fateShards: number };
    creditedXp?: number;
    creditedRyo?: number;
};
type EndlessAction = 'start' | EndlessReceipt['action'];

const receiptsOf = (character: Record<string, unknown>): EndlessReceipt[] => Array.isArray(character.redeemedEndlessActions)
    ? (character.redeemedEndlessActions as EndlessReceipt[]).filter((entry) => entry && typeof entry.key === 'string').slice(-128)
    : [];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const actionRaw = String(body.action ?? '');
        if (!playerName || !['start', 'settle', 'cashout', 'abandon'].includes(actionRaw)) {
            return res.status(400).json({ error: 'Invalid Endless Tower request.' });
        }
        const action = actionRaw as EndlessAction;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your tower run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'endless-run', 40, 60_000, identity.name))) return;

        const runToken = cleanToken(body.runToken);
        const waveRunId = cleanWaveRunId(body.waveRunId);
        const result = await mutatePlayerSave<Record<string, unknown>>(playerName, async ({ character }) => {
            if (action === 'start') {
                const started = startEndlessRun(character, randomUUID().replace(/-/g, ''), dayKey());
                if (!started.ok) return { ok: false as const, status: 409, error: started.reason };
                return {
                    ok: true as const,
                    character: started.character,
                    value: { run: started.run, resumed: started.resumed, cost: started.cost },
                };
            }

            const receipts = receiptsOf(character);
            const requestedKey = action === 'settle' ? waveRunId : runToken;
            const replay = requestedKey
                ? receipts.find((entry) => entry.key === requestedKey && entry.action === action)
                : undefined;
            if (replay) {
                const replayRun = character.endlessTowerRun && typeof character.endlessTowerRun === 'object'
                    ? character.endlessTowerRun as Record<string, unknown>
                    : null;
                return {
                    ok: true as const,
                    character,
                    value: action === 'settle'
                        ? { outcome: replay.outcome, reward: replay.reward, milestone: replay.milestone, run: replayRun, replayed: true }
                        : { creditedXp: replay.creditedXp, creditedRyo: replay.creditedRyo, abandoned: action === 'abandon', replayed: true },
                };
            }

            const run = character.endlessTowerRun && typeof character.endlessTowerRun === 'object'
                ? character.endlessTowerRun as EndlessRun
                : null;
            if (!run || !runToken || run.runToken !== runToken) {
                return { ok: false as const, status: 409, error: 'invalid-or-spent-endless-run' };
            }

            if (action === 'cashout') {
                const paid = cashOutEndless(character, run, dayKey());
                const receipt: EndlessReceipt = {
                    key: runToken,
                    action,
                    creditedXp: paid.creditedXp,
                    creditedRyo: paid.creditedRyo,
                };
                return {
                    ok: true as const,
                    character: { ...paid.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) },
                    value: { creditedXp: paid.creditedXp, creditedRyo: paid.creditedRyo },
                };
            }

            if (action === 'abandon') {
                const receipt: EndlessReceipt = { key: runToken, action };
                return {
                    ok: true as const,
                    character: { ...character, endlessTowerRun: null, redeemedEndlessActions: [...receipts, receipt].slice(-128) },
                    value: { abandoned: true },
                };
            }

            if (!waveRunId) return { ok: false as const, status: 409, error: 'missing-endless-wave-session' };
            const binding = await kv.get<EndlessWaveBinding>(endlessWaveBindingKey(waveRunId));
            const session = await readSoloPveSession(waveRunId);
            const validation = validateTerminalEndlessWave({
                binding,
                session,
                playerName,
                runToken,
                expectedWave: Math.max(1, Math.floor(Number(run.wave) || 1)),
            });
            if (!validation.ok) {
                return { ok: false as const, status: 409, error: `invalid-endless-settlement (${validation.reason})` };
            }

            const chargedCharacter = applySoloPveUsageCosts(character, session!);
            if (validation.outcome === 'win') {
                const won = recordEndlessWin(
                    chargedCharacter,
                    run,
                    validation.binding.wave,
                    endlessWaveVitals(session!, playerName),
                );
                if (!won) return { ok: false as const, status: 409, error: 'unexpected-endless-wave' };
                const receipt: EndlessReceipt = {
                    key: waveRunId,
                    action,
                    outcome: 'win',
                    reward: won.reward,
                    milestone: won.milestone,
                };
                const committed = { ...won.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) };
                return {
                    ok: true as const,
                    character: committed,
                    value: { outcome: 'win' as const, reward: won.reward, milestone: won.milestone, run: committed.endlessTowerRun as Record<string, unknown>, replayed: false },
                };
            }

            const ended = applyAiFightOutcomeToCharacter(
                chargedCharacter,
                validation.outcome === 'fled' ? 'forfeit' : validation.outcome,
                session!.player,
                Date.now(),
            );
            const receipt: EndlessReceipt = { key: waveRunId, action, outcome: validation.outcome };
            return {
                ok: true as const,
                character: { ...ended, endlessTowerRun: null, redeemedEndlessActions: [...receipts, receipt].slice(-128) },
                value: { outcome: validation.outcome, run: null, ended: true, replayed: false },
            };
        });

        if (!result.ok) return res.status(result.status).json({ error: result.error });

        if (action === 'settle' && waveRunId) {
            const binding = await kv.get<EndlessWaveBinding>(endlessWaveBindingKey(waveRunId)).catch(() => null);
            const session = await readSoloPveSession(waveRunId).catch(() => null);
            if (binding && session
                && binding.playerName === playerName
                && binding.runToken === runToken
                && session.ownerSlug === playerName
                && session.status === 'done') {
                if (session.settlementState !== 'settled') {
                    await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
                        kind: 'endless-wave',
                        id: waveRunId,
                        settledAt: Date.now(),
                        rewards: { outcome: String((result.value as { outcome?: string }).outcome ?? session.outcome ?? 'unknown') },
                    }));
                }
                if (!binding.settledAt && binding.status === 'active') {
                    await kv.set(
                        endlessWaveBindingKey(waveRunId),
                        settleEndlessWaveBinding(binding, Date.now(), session.outcome === 'win'),
                        { ex: ENDLESS_WAVE_TTL_SECONDS },
                    );
                }
            }
        }

        return res.status(200).json({
            ok: true,
            ...result.value,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    } catch (error) {
        console.error('[endless/run]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
