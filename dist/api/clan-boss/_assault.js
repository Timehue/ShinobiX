"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assaultKey = assaultKey;
exports.loadAssault = loadAssault;
exports.saveAssault = saveAssault;
exports.extractAssaultResult = extractAssaultResult;
/*
 * Clan-boss assault side-record + result extraction.
 *
 * An assault reuses the whole Battle-Towers session lifecycle (start-encounter →
 * /api/towers/action loop → 'done'). This side record tags a tower runId as a
 * clan-boss assault so settle knows which clan/week/party to bank it into, and
 * gates settle to exactly once. The RESULT (damage/rounds/wipe/clean) is read
 * from the finished, server-authoritative session — never from the client.
 */
const _storage_js_1 = require("../_storage.js");
const _tower_session_js_1 = require("../towers/_tower-session.js");
// A run must be settled within this window; matches the tower session TTL ballpark.
const ASSAULT_TTL_SEC = 6 * 60 * 60;
function assaultKey(runId) { return `clan-boss:assault:${runId}`; }
async function loadAssault(runId) {
    return _storage_js_1.kv.get(assaultKey(runId));
}
async function saveAssault(rec) {
    await _storage_js_1.kv.set(assaultKey(rec.runId), rec, { ex: ASSAULT_TTL_SEC });
}
/** Server-trusted result of a FINISHED clan-boss tower session. */
function extractAssaultResult(session) {
    const bossId = session.phaseState?.bossId;
    const boss = bossId ? (0, _tower_session_js_1.getActor)(session, bossId) : undefined;
    // Damage the party removed from the boss (= its maxHp minus what's left; full on a kill).
    const damage = boss ? Math.max(0, Math.round(boss.maxHp - boss.hp)) : 0;
    const won = session.winner === 'squad';
    const squad = (0, _tower_session_js_1.actorsOnSide)(session, 'squad');
    const squadAlive = (0, _tower_session_js_1.livingOnSide)(session, 'squad').length;
    // A true wipe = the whole party fell. A timeout (squad alive, boss not dead) is
    // NOT a wipe — it just banks partial damage with no wipe penalty and no clean bonus.
    const wiped = squad.length > 0 && squadAlive === 0;
    const clean = won && squad.every(a => a.hp > 0);
    return { won, damage, rounds: Math.max(1, session.round), wiped, clean };
}
