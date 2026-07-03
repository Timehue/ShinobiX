/*
 * Clan Raid Boss — storage + pure math.
 *
 * An ASYNC, weekly, clan-cooperative boss. Every clan member chips a single
 * shared-HP boss on their own schedule (a few attempts each per week). Strike
 * damage is computed SERVER-SIDE from the member's saved stats — the client
 * never reports damage — so the whole loop is authoritative with no token
 * needed. Rewards pay every participant by their share of damage (with a floor
 * so showing up always pays), plus a kill bonus for everyone if the boss dies.
 *
 * Scaled for a small server (≤100 players → a few dozen clans, most of them
 * small): boss HP scales PER-CAPITA with roster size, so a 4-person clan needs
 * roughly the same effort-per-member as a 20-person clan and can actually kill
 * it. There is no leaderboard-tier / matchmaking machinery — one boss per clan
 * per week is the right shape at this scale.
 *
 * Feature-gated: every endpoint 404s unless ENABLE_CLAN_RAID==='1', and the
 * client tab is gated on the clanRaid.v1 flag, so this ships inert.
 */
import { kv } from '../../_storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE — every number here is tunable and NEEDS SIGN-OFF before the feature
// is switched on (ENABLE_CLAN_RAID=1). All rewards are NON-combat (ryo / clan
// XP / contribution points) to honour the balanced-PvP pillar: clan activity
// must never sell combat power.
// ─────────────────────────────────────────────────────────────────────────────

// Boss HP scales with roster size so small clans stay first-class.
export const RAID_BASE_HP = 4000;          // floor so a 1–2 person clan still has a boss
export const RAID_HP_PER_MEMBER = 3000;    // added per member the clan has
export const RAID_MEMBER_CAP = 25;         // HP stops scaling past this roster size
export const RAID_ATTEMPTS_PER_MEMBER = 3; // strikes each member gets per weekly raid

// Strike damage: (BASE + level*PER_LEVEL) * (1 + statBonus) * variance [* crit].
// Tuned so an average mid-level member kills their per-capita share in ~3 hits.
export const RAID_STRIKE_BASE = 300;
export const RAID_STRIKE_PER_LEVEL = 30;
export const RAID_STAT_DIVISOR = 8000;     // statTotal / divisor → bonus fraction
export const RAID_STAT_BONUS_CAP = 0.5;    // stats add at most +50%
export const RAID_VARIANCE = 0.15;         // ±15% per-hit variance
export const RAID_CRIT_CHANCE = 0.12;      // 12% chance
export const RAID_CRIT_MULT = 1.5;

// Personal reward, paid once per member on claim (only after the boss is killed).
export const RAID_RYO_POOL = 20000;        // split across participants by damage share
export const RAID_MIN_PERSONAL_RYO = 800;  // floor — any participant gets at least this
export const RAID_KILL_BONUS_MULT = 1.5;   // personal ryo ×this because the boss died
export const RAID_PARTICIPATION_CONTRIB = 4; // clanEventContrib per participant
export const RAID_TOP_CONTRIB_BONUS = 6;     // extra clanEventContrib for the top dealer

// Clan-level reward, paid ONCE (first claim after a kill).
export const RAID_KILL_CLAN_XP = 600;
export const RAID_KILL_TREASURY_RYO = 5000;

// ─────────────────────────────────────────────────────────────────────────────

export type RaidBoss = {
    id: string;
    name: string;
    icon: string;
    flavor: string;
};

// Rotating weekly boss pool. Deterministic pick by ISO week so a clan can't
// re-roll for an easier boss (they're all the same HP anyway — flavour only).
export const RAID_BOSSES: RaidBoss[] = [
    { id: 'oni-warlord', name: 'The Oni Warlord', icon: '👹', flavor: 'A horned giant that razed three border villages. Its club splinters stone.' },
    { id: 'abyss-leviathan', name: 'Abyssal Leviathan', icon: '🐉', flavor: 'It surfaced from the drowned trench, dragging a tide of black water behind it.' },
    { id: 'fallen-kage', name: 'The Fallen Kage', icon: '👤', flavor: 'A shadow-clad former leader who traded their village for forbidden power.' },
    { id: 'stone-golem', name: 'Ancient Stone Golem', icon: '🗿', flavor: 'Older than the hidden villages, it wakes only to crush what dares approach.' },
    { id: 'nine-tails', name: 'Nine-Tailed Kitsune', icon: '🦊', flavor: 'A trickster spirit of living flame. Each tail is a jutsu no one has survived.' },
];

export const RAID_BOSS_BY_ID: Record<string, RaidBoss> =
    RAID_BOSSES.reduce((acc, b) => { acc[b.id] = b; return acc; }, {} as Record<string, RaidBoss>);

export type RaidMember = {
    name?: string;          // display name (the map is keyed by safeName slug)
    damage: number;
    attemptsUsed: number;
    claimed: boolean;
};

export type ClanRaid = {
    clanName: string;
    weekId: string;
    bossId: string;
    hpMax: number;
    hp: number;
    memberCountAtStart: number;
    startedAt: number;
    killedAt?: number;
    killedBy?: string;
    members: Record<string, RaidMember>;   // keyed by safeName slug
    clanRewardPaid?: boolean;               // clan XP + treasury paid once, on first claim after kill
    updatedAt: number;
};

// ── Pure math (all unit-tested) ──────────────────────────────────────────────

const STAT_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;

/** Sum of a character's combat stats, read defensively from `character.stats`. */
export function raidStatTotal(character: Record<string, unknown> | null | undefined): number {
    const stats = (character?.stats ?? {}) as Record<string, unknown>;
    let total = 0;
    for (const k of STAT_KEYS) total += Math.max(0, Number(stats[k] ?? 0));
    return total;
}

/** Boss HP for a clan of `memberCount` members. Per-capita so small clans are viable. */
export function raidBossHp(memberCount: number): number {
    const m = Math.max(1, Math.min(RAID_MEMBER_CAP, Math.floor(Number(memberCount) || 1)));
    return RAID_BASE_HP + RAID_HP_PER_MEMBER * m;
}

/**
 * A single strike's damage. `variance` and `critRoll` are floats in [0,1) that
 * the caller derives from a per-attempt seed — kept as params so the math is
 * deterministic and testable (no Math.random inside).
 */
export function raidStrikeDamage(
    level: number,
    statTotal: number,
    variance: number,
    critRoll: number,
): { damage: number; crit: boolean } {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    const base = RAID_STRIKE_BASE + lvl * RAID_STRIKE_PER_LEVEL;
    const statBonus = Math.min(RAID_STAT_BONUS_CAP, Math.max(0, statTotal) / RAID_STAT_DIVISOR);
    // variance in [1-RAID_VARIANCE, 1+RAID_VARIANCE]
    const varFactor = 1 - RAID_VARIANCE + Math.min(0.999999, Math.max(0, variance)) * (2 * RAID_VARIANCE);
    const crit = critRoll < RAID_CRIT_CHANCE;
    let dmg = base * (1 + statBonus) * varFactor;
    if (crit) dmg *= RAID_CRIT_MULT;
    return { damage: Math.max(1, Math.round(dmg)), crit };
}

/** Personal reward for a participant, by their share of total damage (floored). */
export function raidPersonalReward(
    myDamage: number,
    totalDamage: number,
    killed: boolean,
): { ryo: number; contrib: number } {
    const share = totalDamage > 0 ? Math.max(0, myDamage) / totalDamage : 0;
    let ryo = Math.max(RAID_MIN_PERSONAL_RYO, Math.round(RAID_RYO_POOL * share));
    if (killed) ryo = Math.round(ryo * RAID_KILL_BONUS_MULT);
    return { ryo, contrib: RAID_PARTICIPATION_CONTRIB };
}

/** Deterministic ISO-week id, e.g. "2026-W27". One raid record per clan per week. */
export function raidWeekId(now: number): string {
    const d = new Date(now);
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;      // Mon=0 … Sun=6
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(
        ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic boss pick from the week id (all bosses share HP; flavour only). */
export function raidPickBossId(weekId: string): string {
    let h = 0;
    for (let i = 0; i < weekId.length; i++) h = (Math.imul(h, 31) + weekId.charCodeAt(i)) >>> 0;
    return RAID_BOSSES[h % RAID_BOSSES.length].id;
}

/** Two independent [0,1) rolls from a per-attempt seed string (variance, crit). */
export function raidStrikeRolls(seed: string): { variance: number; crit: boolean; critRoll: number } {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    // mulberry32 → two draws
    const draw = () => {
        h = (h + 0x6d2b79f5) >>> 0;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const variance = draw();
    const critRoll = draw();
    return { variance, critRoll, crit: critRoll < RAID_CRIT_CHANCE };
}

// ── KV ───────────────────────────────────────────────────────────────────────

export function clanSlug(clanName: string): string {
    return clanName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function raidKey(clanName: string, weekId: string): string {
    return `clan-raid:${clanSlug(clanName)}:${weekId}`;
}

export async function loadRaid(clanName: string, weekId: string): Promise<ClanRaid | null> {
    return kv.get<ClanRaid>(raidKey(clanName, weekId));
}

export async function saveRaid(raid: ClanRaid): Promise<void> {
    await kv.set(raidKey(raid.clanName, raid.weekId), raid);
}

/** Build a fresh raid record for the current week (does not persist). */
export function newRaid(clanName: string, weekId: string, memberCount: number, now: number): ClanRaid {
    const bossId = raidPickBossId(weekId);
    const hpMax = raidBossHp(memberCount);
    return {
        clanName,
        weekId,
        bossId,
        hpMax,
        hp: hpMax,
        memberCountAtStart: memberCount,
        startedAt: now,
        members: {},
        updatedAt: now,
    };
}

/** Contribution leaderboard (highest damage first) for the public view. */
export function raidLeaderboard(raid: ClanRaid): Array<{ slug: string; name: string; damage: number; attemptsUsed: number }> {
    return Object.entries(raid.members)
        .map(([slug, m]) => ({ slug, name: m.name || slug, damage: m.damage, attemptsUsed: m.attemptsUsed }))
        .filter(e => e.damage > 0 || e.attemptsUsed > 0)
        .sort((a, b) => b.damage - a.damage);
}

/** Name of the single top damage dealer (for the top-contributor bonus), or ''. */
export function raidTopContributor(raid: ClanRaid): string {
    let top = '';
    let best = -1;
    for (const [name, m] of Object.entries(raid.members)) {
        if (m.damage > best) { best = m.damage; top = name; }
    }
    return best > 0 ? top : '';
}
