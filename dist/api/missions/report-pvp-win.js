"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _progress_js_1 = require("./_progress.js");
const _player_ips_js_1 = require("../_player-ips.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_pvp_js_1 = require("../_legacy-pvp.js");
const _era_js_1 = require("../_era.js");
// Quick-surrender protection: fights ending in <15s grant no mission progress.
const MIN_FIGHT_DURATION_MS = 15_000;
const ACCOUNT_AGE_MIN_MS = 72 * 60 * 60 * 1000;
// Replay window: only sessions created in the last 24h can be reported.
// PvP session KV records typically have a 60-min TTL, but a player could
// re-submit a battleId pulled from browser history / logs much later if
// we didn't enforce a recency check.
const SESSION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
// Server-validated report channel for Vanguard PvP-win missions. The client
// calls this after handlePvpWin fires. The server cross-checks the reported
// win against the actual PvpSession state so a malicious client can't just
// claim wins it didn't earn.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Per-player rate limit BEFORE auth so spam at unknown names still
    // throttles. Session-ID + 24h idem key bound the currency damage, but
    // KV spam was previously unbounded.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'report-pvp-win', 4, 60_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const battleId = String(body.battleId ?? '').trim();
        const opponentName = (0, _utils_js_1.safeName)(String(body.opponentName ?? ''));
        if (!playerName || !battleId || !opponentName) {
            return res.status(400).json({ error: 'Missing playerName, battleId, or opponentName.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own wins.' });
        }
        // Validate the win against the actual PvP session. Key is `pvp:${id}`
        // — must match what session.ts writes and move.ts reads (an earlier
        // mismatched `pvp:session:${id}` here silently 404'd every Vanguard
        // PvP-win mission report).
        const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
        if (!session)
            return res.status(404).json({ error: 'Battle session not found or expired.' });
        if (session.status !== 'done' || !session.winner) {
            return res.status(409).json({ error: 'Battle not yet decided.' });
        }
        // Recency check — reject replays of stale sessions. The KV TTL
        // is the primary guard but this defense-in-depth check covers
        // any future TTL bump or admin-revived session.
        const sessionAge = Date.now() - Number(session.createdAt ?? 0);
        if (sessionAge > SESSION_REPLAY_WINDOW_MS) {
            return res.status(409).json({ error: 'Battle session is too old to report.' });
        }
        const winnerName = session.winner === 'p1' ? session.p1.name : session.winner === 'p2' ? session.p2.name : '';
        const loserName = session.winner === 'p1' ? session.p2.name : session.winner === 'p2' ? session.p1.name : '';
        // winnerName/loserName are stored DISPLAY names; playerName/opponentName
        // are safeName slugs — canonicalize both sides through safeName to compare.
        if ((0, _utils_js_1.safeName)(winnerName) !== playerName) {
            return res.status(403).json({ error: 'You are not the winner of this battle.' });
        }
        if ((0, _utils_js_1.safeName)(loserName) !== opponentName) {
            return res.status(400).json({ error: 'Opponent name does not match the recorded loser.' });
        }
        // Look up player's profession. (Both records also feed the Legacy
        // tracking block below, so they're fetched before the Vanguard gate.)
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = record?.character;
        const opponentRecord = await _storage_js_1.kv.get(`save:${opponentName}`);
        const opponentChar = opponentRecord?.character;
        // Quick-surrender duration (shared by Legacy tracking + the Vanguard
        // mission checks below — same numbers, computed once).
        const sessionCreatedAt = Number(session.createdAt ?? 0);
        const sessionLastMove = Number(session.lastMoveAt ?? 0);
        const inSessionDuration = sessionLastMove > sessionCreatedAt
            ? sessionLastMove - sessionCreatedAt
            : (sessionCreatedAt ? Date.now() - sessionCreatedAt : 0);
        // ── Legacy tracking (ENABLE_LEGACY) ─────────────────────────────────
        // Server-owned progression counters for BOTH fighters, recorded before
        // the Vanguard-only mission gate so every player's real wins count.
        // Own NX idempotency key; abuse signals feed suspicionFlags instead of
        // credit. Best-effort — a tracking hiccup never fails the report.
        if ((0, _legacy_track_js_1.legacyEnabled)()) {
            try {
                const tracked = await _storage_js_1.kv.set(`legacy:pvp-tracked:${battleId}`, true, { nx: true, ex: 24 * 60 * 60 });
                if (tracked && inSessionDuration >= MIN_FIGHT_DURATION_MS) {
                    const opponentCreatedForLegacy = Number(opponentChar?.createdAt ?? 0);
                    const youngOpponent = opponentCreatedForLegacy > 0 && (Date.now() - opponentCreatedForLegacy) < ACCOUNT_AGE_MIN_MS;
                    // IP OR device-fingerprint overlap — alts feeding a main
                    // usually share one of the two (anti-farm wave 2).
                    const farmedIp = await (0, _player_ips_js_1.hasRecentIpOrFpOverlap)(playerName, opponentName);
                    if (youngOpponent || farmedIp) {
                        await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, {}, { characterForBootstrap: char ?? null, suspicion: true });
                    }
                    else {
                        const extract = (0, _legacy_pvp_js_1.extractPvpLegacyDeltas)(session, winnerName, loserName);
                        // Queue-defense credit (always available — no war needed):
                        // village-guard/challenge.ts marked this battle server-side.
                        // playerName IS the winner (validated at the 403 gate above);
                        // guard-won → defensiveWins/sectorDefenses, raider-won →
                        // warPvpKills. Marker del'd on read; the pvp-tracked NX above
                        // already makes this whole block once-per-battle.
                        try {
                            const guardMarker = await _storage_js_1.kv.get(`legacy:guard-defense:${battleId}`);
                            if (guardMarker) {
                                await _storage_js_1.kv.del(`legacy:guard-defense:${battleId}`).catch(() => undefined);
                                const gd = (0, _legacy_pvp_js_1.guardDefenseDeltas)({
                                    defender: (0, _utils_js_1.safeName)(String(guardMarker.defender ?? '')),
                                    attacker: (0, _utils_js_1.safeName)(String(guardMarker.attacker ?? '')),
                                }, playerName);
                                for (const [k, v] of Object.entries(gd)) {
                                    const key = k;
                                    extract.winnerDeltas[key] = (extract.winnerDeltas[key] ?? 0) + v;
                                }
                            }
                        }
                        catch { /* best-effort — defense credit is non-blocking */ }
                        const winnerLevel = Number(char?.level ?? 0) || 0;
                        const loserLevel = Number(opponentChar?.level ?? 0) || 0;
                        await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, extract.winnerDeltas, {
                            characterForBootstrap: char ?? null,
                            pvpTarget: opponentName,
                            pvpLevelGap: winnerLevel - loserLevel,
                            streak: 'win',
                        });
                        await (0, _legacy_track_js_1.bumpLegacyStats)(opponentName, extract.loserDeltas, {
                            characterForBootstrap: opponentChar ?? null,
                            streak: 'reset',
                        });
                        await (0, _era_js_1.bumpEraContribution)('pvpWins');
                    }
                }
            }
            catch (legacyErr) {
                console.error('[report-pvp-win] legacy tracking failed:', legacyErr);
            }
        }
        if (char?.profession !== 'vanguard') {
            // Not a Vanguard — nothing to do, but return 200 so the client
            // doesn't treat it as an error.
            return res.status(200).json({ ok: true, vanguard: false });
        }
        // Anti-abuse checks (mission rewards only; Honor Seals are gated
        // client-side until server-side rewards land).
        //
        // Quick-surrender check: require that the LAST committed move was
        // at least MIN_FIGHT_DURATION_MS after session creation. The naive
        // "Date.now() - createdAt" check could be passed by waiting 15s in
        // the lobby then firing a win-report after a single move — the
        // actual fighting had ~0 duration. session.lastMoveAt is server-
        // stamped on every successful api/pvp/move call, so spoofing it
        // requires real moves landing 15s apart (which IS legitimate play).
        // (Duration + opponent record computed above, shared with Legacy tracking.)
        if (inSessionDuration < MIN_FIGHT_DURATION_MS) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'quick-surrender', xpAwarded: 0, missionsCompleted: [] });
        }
        const opponentCreated = Number(opponentChar?.createdAt ?? 0);
        if (opponentCreated > 0 && (Date.now() - opponentCreated) < ACCOUNT_AGE_MIN_MS) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'account-too-young', xpAwarded: 0, missionsCompleted: [] });
        }
        const sharesIp = await (0, _player_ips_js_1.hasRecentIpOverlap)(playerName, opponentName);
        if (sharesIp) {
            return res.status(200).json({ ok: true, vanguard: true, reason: 'same-ip', xpAwarded: 0, missionsCompleted: [] });
        }
        // Idempotency: atomic NX reserve. Two concurrent reports racing for
        // the same battleId both used to pass a separate get→check→set, both
        // applied XP. Now the loser sees the NX fail and short-circuits with
        // alreadyReported. 24h TTL covers any reasonable retry window.
        const idemKey = `missions:pvp-reported:${playerName}:${battleId}`;
        const placed = await _storage_js_1.kv.set(idemKey, true, { nx: true, ex: 24 * 60 * 60 });
        if (!placed) {
            return res.status(200).json({ ok: true, alreadyReported: true });
        }
        const winsResult = await (0, _progress_js_1.reportMissionEvent)({
            playerName,
            profession: 'vanguard',
            kind: 'vanguard-pvp-wins',
        });
        const uniqueResult = await (0, _progress_js_1.reportMissionEvent)({
            playerName,
            profession: 'vanguard',
            kind: 'vanguard-pvp-unique',
            targetName: opponentName.toLowerCase(),
        });
        return res.status(200).json({
            ok: true,
            vanguard: true,
            xpAwarded: winsResult.xpAwarded + uniqueResult.xpAwarded,
            missionsCompleted: [...winsResult.missionsCompleted, ...uniqueResult.missionsCompleted],
        });
    }
    catch (err) {
        console.error('[missions/report-pvp-win]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
