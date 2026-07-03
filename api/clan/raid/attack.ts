import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { LockContendedError } from '../../_lock.js';
import {
    RAID_ATTEMPTS_PER_MEMBER, RAID_BOSS_BY_ID, clanSlug, loadRaid, newRaid, raidKey,
    raidStatTotal, raidStrikeDamage, raidStrikeRolls, raidWeekId, saveRaid,
} from './_storage.js';

// One server-authoritative strike against the clan raid boss. Damage is computed
// here from the caller's SAVED stats — the client reports nothing — so there is
// no value to seal in a token. Consumes one of the member's weekly attempts.
// Gated off by default — 404 unless ENABLE_CLAN_RAID==='1'.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_RAID !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only strike as yourself.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-raid-attack', 30, 60_000, identity.name))) return;

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        if (!char) return res.status(404).json({ error: 'Character not found.' });
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to raid.' });

        const level = Math.max(1, Math.floor(Number(char.level ?? 1)));
        const statTotal = raidStatTotal(char);
        const weekId = raidWeekId(Date.now());

        const clanRec = await kv.get<{ members?: Array<unknown> }>(`save:clan-${clanSlug(clanName)}`);
        const memberCount = Array.isArray(clanRec?.members) ? clanRec!.members!.length : 1;

        // All raid-record mutation happens under the raid lock, failClosed so two
        // simultaneous strikes can't both read the same HP and lose a hit.
        const result = await withKvLock(raidKey(clanName, weekId), async () => {
            const raid = (await loadRaid(clanName, weekId)) ?? newRaid(clanName, weekId, memberCount, Date.now());
            if (raid.killedAt) {
                return { status: 200 as const, body: { ok: true, killed: true, alreadyDefeated: true, hp: 0, hpMax: raid.hpMax } };
            }
            const member = raid.members[playerName] ?? { damage: 0, attemptsUsed: 0, claimed: false };
            if (member.attemptsUsed >= RAID_ATTEMPTS_PER_MEMBER) {
                return { status: 400 as const, body: { error: 'No raid attempts left this week.', attemptsLeft: 0 } };
            }

            const seed = `${playerName}:${weekId}:${member.attemptsUsed}`;
            const { variance, critRoll } = raidStrikeRolls(seed);
            const { damage, crit } = raidStrikeDamage(level, statTotal, variance, critRoll);

            const dealt = Math.min(damage, raid.hp);
            raid.hp = Math.max(0, raid.hp - damage);
            member.damage += dealt;
            member.attemptsUsed += 1;
            member.name = String(char.name ?? playerName);   // display name for the leaderboard
            raid.members[playerName] = member;
            raid.updatedAt = Date.now();

            let killed = false;
            if (raid.hp <= 0 && !raid.killedAt) {
                raid.killedAt = Date.now();
                raid.killedBy = playerName;
                killed = true;
            }
            await saveRaid(raid);

            const boss = RAID_BOSS_BY_ID[raid.bossId];
            return {
                status: 200 as const,
                body: {
                    ok: true,
                    damage: dealt,
                    crit,
                    hp: raid.hp,
                    hpMax: raid.hpMax,
                    killed,
                    bossName: boss?.name ?? 'the raid boss',
                    myDamage: member.damage,
                    attemptsLeft: Math.max(0, RAID_ATTEMPTS_PER_MEMBER - member.attemptsUsed),
                },
            };
        }, { failClosed: true });

        return res.status(result.status).json(result.body);
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(409).json({ error: 'The boss is under attack by a clanmate — try again in a moment.' });
        }
        console.error('[clan/raid/attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
