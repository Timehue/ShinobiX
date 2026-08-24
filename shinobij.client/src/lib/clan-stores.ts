/*
 * Clan Stores — the CLAN mirror of Village Stores, as numbers and sentences.
 *
 * The mirror shipped fully wired and completely invisible: donating a ration
 * pack at the Clan Hall already routes into `clanTreasury.provisions`
 * (api/clan/treasury/donate.ts), and the daily pass already burns
 * CLAN_WAR_RATIONS_PER_DAY out of it per active clan war and stamps
 * `storesFed` on the war row (api/_village-stores-daily.ts) — but no clan
 * screen ever said so, so members fed a pool they could not see.
 *
 * Everything here is PURE and display-only. It changes no rule, cost, cap,
 * reward or authority: the server still decides what a donation credits, what a
 * war burns, and who may spend. These helpers only let the Clan Hall SAY it, so
 * the copy and the arithmetic are testable without a DOM.
 *
 * The canonical unit is RATIONS. The stockpile is called PROVISIONS. Never
 * "provisions points", "craft points" or "pts".
 */
import {
    DAILY_RATION_DONATION_CAP,
    WAR_RATIONS_PER_DAY,
    storesDonatedToday,
} from "./village-stores";

/**
 * Rations ONE active clan war burns per day. Mirror of
 * CLAN_WAR_RATIONS_PER_DAY in api/_village-stores-daily.ts, which is itself
 * WAR_RATIONS_PER_DAY — imported rather than restated so the two cannot drift.
 */
export const CLAN_WAR_RATIONS_PER_DAY = WAR_RATIONS_PER_DAY;

/** Days of war a clan wants covered before the readout stops warning. Display
 *  only — the server's fed/unfed verdict is unchanged. */
export const CLAN_LOW_RATION_DAYS = 2;

const nonNeg = (v: unknown) => {
    const n = Math.floor(Number(v) || 0);
    return n > 0 ? n : 0;
};

const isKnown = (v: unknown): boolean => v !== null && v !== undefined && Number.isFinite(Number(v));

// ── Today's fed / unfed verdict ─────────────────────────────────────────────

/** The UTC day key the daily pass stamps as `storesDate` on a clan-war row. */
export function storesDayKey(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** The two stores fields the clan daily pass writes onto a clan-war row. */
export type ClanWarStoresRow = { storesDate?: string; storesFed?: Record<string, boolean> };

/**
 * Today's fed/unfed verdict for `clan` on one clan-war row, or null when the
 * row carries no verdict for TODAY — never stamped, stamped for an older UTC
 * day, or stamped without this clan in it. A stale verdict must never be shown
 * as the current one, and "we have not been told" must never render as "unfed".
 */
export function clanWarFedToday(row: ClanWarStoresRow | null | undefined, clan: string, now: number = Date.now()): boolean | null {
    if (!row || typeof row !== "object") return null;
    if (String(row.storesDate ?? "") !== storesDayKey(now)) return null;
    const fed = row.storesFed;
    if (!fed || typeof fed !== "object") return null;
    const verdict = fed[clan];
    return typeof verdict === "boolean" ? verdict : null;
}

// ── The burn / held projection ──────────────────────────────────────────────

/** Rations `activeWars` clan wars burn per day, all together. */
export function clanRationBurnPerDay(activeWars: number): number {
    return nonNeg(activeWars) * CLAN_WAR_RATIONS_PER_DAY;
}

/** Whole days of war the held rations cover — null when nothing is burning, or
 *  when the stock was never read (a bare 0 must not stand in for "unknown"). */
export function clanRationDaysCovered(provisions: number | null | undefined, activeWars: number): number | null {
    if (!isKnown(provisions)) return null;
    const burn = clanRationBurnPerDay(activeWars);
    if (burn <= 0) return null;
    return Math.floor(nonNeg(provisions) / burn);
}

/** "1,240 rations" — null when the clan treasury carries no figure at all. */
export function clanRationsHeldLabel(provisions: number | null | undefined): string | null {
    if (!isKnown(provisions)) return null;
    const n = nonNeg(provisions);
    return `${n.toLocaleString()} ration${n === 1 ? "" : "s"}`;
}

/** "30 rations a day" / "60 rations a day across 2 wars" / the peace case. */
export function clanRationBurnLabel(activeWars: number): string {
    const wars = nonNeg(activeWars);
    if (wars <= 0) return "None while at peace";
    const burn = clanRationBurnPerDay(wars);
    return wars === 1
        ? `${burn.toLocaleString()} rations a day`
        : `${burn.toLocaleString()} rations a day across ${wars.toLocaleString()} wars`;
}

export type ClanStoresTone = "neutral" | "warn" | "danger";

export type ClanStoresReadout = {
    tone: ClanStoresTone;
    /** "1,240 rations" — null when the clan has never stocked any. */
    held: string | null;
    /** What the wars draw per day. */
    burn: string;
    /** "41 days of war covered" — null when nothing is burning or nothing read. */
    cover: string | null;
    /** One sentence for the section body. */
    line: string;
};

export type ClanStoresReadoutInput = {
    clanName: string;
    /**
     * Rations the clan treasury holds. null/undefined means the treasury
     * carries no provisions figure at all — that is NOT the number zero, and
     * the readout must never assert "0 rations" from it.
     */
    provisions?: number | null;
    /** Active (not ended) clan wars this clan is fighting. */
    activeWars: number;
    /** Of those, how many today's daily pass marked unfed. */
    unfedWars?: number | null;
};

const STOCK_CALL = "Cook ration packs at the Cafeteria, then donate them on the Treasury tab.";

/**
 * The Clan Wars status readout, or null — silence — when there is nothing to
 * report: a clan at peace with nothing on the shelves is never nagged, and a
 * treasury figure that was never written is never rendered as zero.
 */
export function clanStoresReadout(input: ClanStoresReadoutInput): ClanStoresReadout | null {
    const clan = String(input.clanName ?? "").trim() || "Your clan";
    const activeWars = nonNeg(input.activeWars);
    const provisions = isKnown(input.provisions) ? nonNeg(input.provisions) : null;
    if (activeWars <= 0 && !(provisions !== null && provisions > 0)) return null;

    const held = clanRationsHeldLabel(provisions);
    const burn = clanRationBurnLabel(activeWars);
    const days = clanRationDaysCovered(provisions, activeWars);
    const cover = days === null ? null : `${days.toLocaleString()} day${days === 1 ? "" : "s"} of war covered`;
    // An unfed war can only ever be one of the wars actually running, so a
    // stale count can never raise a siege alarm on a clan at peace.
    const unfed = Math.min(nonNeg(input.unfedWars), activeWars);

    if (activeWars <= 0) {
        return {
            tone: "neutral",
            held,
            burn,
            cover,
            line: `${clan} is at peace — ${held} stand ready and nothing is drawn. A clan war burns ${CLAN_WAR_RATIONS_PER_DAY} rations a day.`,
        };
    }
    if (unfed > 0) {
        return {
            tone: "danger",
            held,
            burn,
            cover,
            line: `${clan} went unfed today — the war costs ${burn} and the stores could not cover it. ${STOCK_CALL}`,
        };
    }
    if (provisions === null) {
        return {
            tone: "danger",
            held,
            burn,
            cover,
            line: `No rations are stocked yet, and this war costs ${burn}. ${STOCK_CALL}`,
        };
    }
    if (provisions <= 0) {
        return {
            tone: "danger",
            held,
            burn,
            cover,
            line: `The clan stores stand empty, and this war costs ${burn}. ${STOCK_CALL}`,
        };
    }
    if (days !== null && days < CLAN_LOW_RATION_DAYS) {
        return {
            tone: "warn",
            held,
            burn,
            cover,
            line: `${held} left against ${burn} — under ${CLAN_LOW_RATION_DAYS} days of war. ${STOCK_CALL}`,
        };
    }
    return {
        tone: "neutral",
        held,
        burn,
        cover,
        line: `${held} in the clan stores against ${burn} — ${cover}. The daily pass draws it automatically.`,
    };
}

// ── Donating rations to the clan ────────────────────────────────────────────

/** The donor's own daily ration allowance, which is SHARED with Town Hall
 *  donations (both legs read one `storesDonatedDate` stamp on the save). */
export function clanRationDonationCapLine(character: object, now: number = Date.now()): string {
    const used = nonNeg(storesDonatedToday(character, now).rations);
    return `Rations donated today: ${used.toLocaleString()}/${DAILY_RATION_DONATION_CAP.toLocaleString()}. This allowance is shared with Town Hall donations and resets at midnight UTC.`;
}

/** Ration packs one press may send: what the player carries, clamped to what is
 *  left of the shared daily allowance. The server is still the authority — this
 *  only keeps a 429 from being the first thing a donor hears. */
export function clanRationDonationCount(character: object, owned: number, now: number = Date.now()): number {
    const used = nonNeg(storesDonatedToday(character, now).rations);
    const remaining = Math.max(0, DAILY_RATION_DONATION_CAP - used);
    return Math.min(nonNeg(owned), remaining);
}

/** Why the ration button is off, as a sentence — null when it is live. */
export function clanRationDonateBlock(character: object, owned: number, now: number = Date.now()): string | null {
    if (nonNeg(owned) <= 0) return "You are not carrying any ration packs. Cook them at the Cafeteria.";
    if (clanRationDonationCount(character, owned, now) <= 0) {
        return `Daily limit reached — ${DAILY_RATION_DONATION_CAP.toLocaleString()} rations donated today. The allowance resets at midnight UTC.`;
    }
    return null;
}

/** The button says what the button does, including how much it will send. */
export function clanRationDonateLabel(count: number): string {
    const n = nonNeg(count);
    if (n <= 0) return "Donate Ration Packs";
    return n === 1 ? "Donate 1 Ration Pack" : `Donate ${n.toLocaleString()} Ration Packs`;
}

/** The confirmation after a routed ration donation: how many rations were
 *  credited, and what the clan holds now. `held` is null when the server
 *  reported no stores credit (the mirror's kill switch is on server-side and
 *  the packs stayed loose treasury items). */
export function clanRationCreditLine(clanName: string, credited: number, held: number | null | undefined): string {
    const clan = String(clanName ?? "").trim() || "your clan";
    const n = nonNeg(credited);
    if (!isKnown(held)) {
        return `${n.toLocaleString()} ration pack${n === 1 ? "" : "s"} donated to ${clan}'s treasury.`;
    }
    return `+${n.toLocaleString()} ration${n === 1 ? "" : "s"} to ${clan}'s war stores — ${nonNeg(held).toLocaleString()} now held.`;
}
