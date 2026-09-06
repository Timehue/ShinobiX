// "While you were away…" — the heartbeat delivers one-shot notices queued by
// the server when this player was knocked out OFFLINE (their sleeper camp was
// struck by another player, or raided by NPC war mercenaries; see
// api/player/_offline-notices.ts). Without these the player just wakes up in
// the hospital with no idea what happened.
//
// The inbox holds up to TEN notices. They used to be shown as one alert() each,
// which GameAlert queues one-behind-another: a player back from a week away had
// to click OK ten times before they could move. They are now folded into a
// SINGLE "While you were away" digest — one modal, newest first, with the one
// notice that asks something of the player (the unfed siege) pinned to the top.
//
// Every notice carries `at`, so every line is stamped with a relative time
// ("2d ago — …"); a tenseless message left the player unable to tell a raid six
// days old from one six minutes old. `relativeAgo` is imported from
// lib/village-stores rather than re-implemented.

import { relativeAgo } from './village-stores';
import { takeUnseenNotices } from './notice-ack';

export type OfflineNoticeKind = 'sleeper-kill' | 'merc-raid' | 'bounty-placed' | 'bounty-claimed' | 'kage-seat-lost' | 'kage-challenge-refunded' | 'village-unfed';

export type OfflineNotice = {
    kind: OfflineNoticeKind;
    by: string;
    village?: string;
    sector: number;
    at: number;
    /** bounty-placed / bounty-claimed: ryo staked / collected. */
    amount?: number;
    /** bounty-placed: the head's pool after this stake. */
    total?: number;
    /** kage-seat-lost: how long the reign lasted, in ms. Optional — notices
     *  queued before the field existed simply omit the tenure sentence. */
    tenureMs?: number;
};

const NOTICE_KINDS: ReadonlySet<string> = new Set<OfflineNoticeKind>(['sleeper-kill', 'merc-raid', 'bounty-placed', 'bounty-claimed', 'kage-seat-lost', 'kage-challenge-refunded', 'village-unfed']);

function isNotice(v: unknown): v is OfflineNotice {
    if (!v || typeof v !== 'object') return false;
    const n = v as Record<string, unknown>;
    return typeof n.kind === 'string' && NOTICE_KINDS.has(n.kind)
        && typeof n.by === 'string'
        && typeof n.sector === 'number';
}

export function parseOfflineNotices(notices: unknown): OfflineNotice[] {
    return Array.isArray(notices) ? notices.filter(isNotice) : [];
}

// ── Emoji vocabulary ────────────────────────────────────────────────────────
// One glyph per FAMILY, not per event. `☠` (bounty collected) and `⚔️` (camp
// ambush) used to read as two near-duplicate "you were killed" marks; the
// bounty pair now shares the coin, and both violent camp events share the
// blades, so four glyphs cover the whole inbox.
const NOTICE_ICON: Record<OfflineNoticeKind, string> = {
    'village-unfed': '🍚',
    'kage-seat-lost': '👑',
    'kage-challenge-refunded': '👑',
    'bounty-placed': '💰',
    'bounty-claimed': '💰',
    'merc-raid': '⚔️',
    'sleeper-kill': '⚔️',
};

/** The one kind that asks the player to DO something — it sorts to the top. */
const ACTIONABLE_KINDS: ReadonlySet<OfflineNoticeKind> = new Set<OfflineNoticeKind>(['village-unfed']);

export type OfflineNoticeTone = 'action' | 'grave' | 'info';

const NOTICE_TONE: Record<OfflineNoticeKind, OfflineNoticeTone> = {
    'village-unfed': 'action',
    'kage-seat-lost': 'grave',
    'kage-challenge-refunded': 'info',
    'bounty-placed': 'info',
    'bounty-claimed': 'grave',
    'merc-raid': 'grave',
    'sleeper-kill': 'grave',
};

const COUNT_WORD = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** Prose tenure span ("6 days", "5 hours", "12 minutes") for the lost-seat line. */
function formatTenure(ms: number): string {
    const total = Math.max(0, Math.floor(Number(ms) || 0));
    const days = Math.floor(total / 86_400_000);
    if (days > 0) return `${days} day${days === 1 ? '' : 's'}`;
    const hours = Math.floor(total / 3_600_000);
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const mins = Math.max(1, Math.floor(total / 60_000));
    return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/** The notice body, with no icon and no timestamp — those are added around it. */
export function offlineNoticeBody(n: OfflineNotice): string {
    const who = n.by.trim() || 'someone';
    if (n.kind === 'village-unfed') {
        const village = n.village ?? (who !== 'someone' ? who : 'Your village');
        return `${village} marched hungry: the siege of Sector ${n.sector} went unfed. Cook rations at the Cafeteria and donate them at the Town Hall.`;
    }
    if (n.kind === 'kage-challenge-refunded') {
        return `Your Kage challenge in ${n.village ?? 'your village'} was cancelled — the Kage went absent. Your stake was refunded.`;
    }
    if (n.kind === 'kage-seat-lost') {
        const council = n.village ? `the ${n.village} council` : 'the village council';
        const tenure = Number(n.tenureMs) > 0 ? ` Your tenure lasted ${formatTenure(Number(n.tenureMs))}.` : '';
        return `Ten days passed without word from you, and ${council} declared the seat open.${tenure} The seat can be won back.`;
    }
    if (n.kind === 'bounty-placed') {
        const amount = Math.max(0, Math.floor(Number(n.amount) || 0));
        const total = Math.max(amount, Math.floor(Number(n.total) || 0));
        return `${who} put ${amount.toLocaleString()} ryo on your head (total ${total.toLocaleString()}). You're on the bounty board.`;
    }
    if (n.kind === 'bounty-claimed') {
        const amount = Math.max(0, Math.floor(Number(n.amount) || 0));
        return `${who} collected the ${amount.toLocaleString()}-ryo bounty on you.`;
    }
    if (n.kind === 'merc-raid') {
        return `${who} raided your camp in Sector ${n.sector} while you were away. You were carried to the hospital.`;
    }
    return `While you slept in Sector ${n.sector}, ${who} ambushed your camp. You were carried to the hospital.`;
}

/** Icon + body, for any caller that still wants a single notice as one string. */
export function offlineNoticeMessage(n: OfflineNotice): string {
    return `${NOTICE_ICON[n.kind]} ${offlineNoticeBody(n)}`;
}

// ── Digest ──────────────────────────────────────────────────────────────────

export type OfflineNoticeDigestEntry = {
    kind: OfflineNoticeKind;
    icon: string;
    /** "2d ago" — empty when the notice carries no usable stamp. */
    when: string;
    text: string;
    tone: OfflineNoticeTone;
    /** True for the notice that asks the player to act; it sorts first. */
    actionable: boolean;
    at: number;
};

export type OfflineNoticeDigest = {
    title: string;
    subtitle: string;
    entries: OfflineNoticeDigestEntry[];
};

/**
 * Fold the inbox into one digest: the actionable notice first, then everything
 * else NEWEST first. Pure — the modal and the plain-text fallback both read it.
 */
export function buildOfflineNoticeDigest(notices: unknown, now: number = Date.now()): OfflineNoticeDigest {
    const entries: OfflineNoticeDigestEntry[] = parseOfflineNotices(notices).map((n) => {
        const at = Math.floor(Number(n.at) || 0);
        return {
            kind: n.kind,
            icon: NOTICE_ICON[n.kind],
            when: at > 0 ? relativeAgo(at, now) : '',
            text: offlineNoticeBody(n),
            tone: NOTICE_TONE[n.kind],
            actionable: ACTIONABLE_KINDS.has(n.kind),
            at,
        };
    });
    entries.sort((a, b) => (Number(b.actionable) - Number(a.actionable)) || (b.at - a.at));
    const count = entries.length;
    const word = COUNT_WORD[count] ?? String(count);
    return {
        title: 'While you were away',
        subtitle: count === 1
            ? 'One report was waiting when you returned.'
            : `${word} reports were waiting when you returned.`,
        entries,
    };
}

/** One rendered line per notice: "💰 2d ago — Kenji collected the …". */
export function offlineNoticeDigestLines(digest: OfflineNoticeDigest): string[] {
    return digest.entries.map((e) => (e.when ? `${e.icon} ${e.when} — ${e.text}` : `${e.icon} ${e.text}`));
}

/** The whole digest as one plain-text block, for the alert() fallback path. */
export function offlineNoticeDigestText(digest: OfflineNoticeDigest): string {
    return [`${digest.title} — ${digest.subtitle}`, '', ...offlineNoticeDigestLines(digest)].join('\n');
}

/**
 * Validate the heartbeat's `pendingNotices` payload and show ONE digest for the
 * whole inbox. Returns how many notices were delivered.
 *
 * The optional `show` keeps the old string-sink shape for tests and for any
 * caller that wants the plain-text form; with no sink, the themed digest modal
 * is mounted lazily (components/OfflineNoticeDigestHost) so the copy and the
 * host stay off the entry graph, exactly as before.
 */
export function applyOfflineNotices(notices: unknown, show?: (message: string) => void): number {
    // Under the acknowledgement protocol the server re-delivers a notice until
    // its id is acknowledged, so a lost response or a reconnect can carry the
    // same report again. Show each id once per session (lib/notice-ack).
    const digest = buildOfflineNoticeDigest(takeUnseenNotices(parseOfflineNotices(notices)));
    if (digest.entries.length === 0) return 0;
    if (show) show(offlineNoticeDigestText(digest));
    else void import('../components/OfflineNoticeDigestHost').then((m) => m.showOfflineNoticeDigest(digest));
    return digest.entries.length;
}
