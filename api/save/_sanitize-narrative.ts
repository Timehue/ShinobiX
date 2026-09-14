import { storyFieldTraits } from '../../shared/story-field-work.js';
import { normalizeMasteryFocus } from '../../shared/activity-spine.js';
import { TEXT_LIMITS, sanitizeUserText, isAllowedCustomTitle, isCleanText } from '../_text-moderation.js';
import {
    normalizeTitleKey,
    isServerCreditedTitle,
    isKnownEarnedTitle,
    TITLE_STYLE_IDS,
    TITLE_ICON_SET,
} from '../_titles-registry.js';
import { legacyEnabled } from '../_legacy-track.js';

const narrativeId = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';

const narrativeIndex = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

function sanitizeNarrativeChoices(...sources: unknown[]): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [], seen = new Set<string>();
    for (const source of sources) for (const raw of Array.isArray(source) ? source : []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const eventId = narrativeId(row.eventId), pageId = narrativeId(row.pageId), choiceId = narrativeId(row.choiceId);
        if (!eventId || !pageId || !choiceId) continue;
        const suffix = row.battle === true ? '\u0000terminal' : row.revisitable === true ? `\u0000${choiceId}` : '';
        const key = `${eventId}\u0000${pageId}${suffix}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const trait = narrativeId(row.trait);
        out.push({
            version: 1, eventId, pageId, choiceId,
            pageIndex: narrativeIndex(row.pageIndex, 999),
            choiceIndex: narrativeIndex(row.choiceIndex, 99),
            nextPage: narrativeIndex(row.nextPage, 999),
            ...(trait ? { trait } : {}),
            ...(row.battle === true ? { battle: true } : {}),
            ...(row.revisitable === true ? { revisitable: true } : {}),
        });
        if (out.length >= 512) return out;
    }
    return out;
}

function sanitizeNarrativeReports(value: unknown): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [], seen = new Set<string>();
    for (const raw of Array.isArray(value) ? value : []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const kind = row.kind === 'interlude' || row.kind === 'road' ? row.kind : null;
        const eventId = narrativeId(row.eventId), trait = narrativeId(row.trait);
        if (!kind || !eventId || !trait || seen.has(`${kind}:${eventId}`)) continue;
        seen.add(`${kind}:${eventId}`);
        const recordedTrait = narrativeId(row.recordedTrait);
        out.push({ version: 1, kind, eventId, trait,
            ...(row.status === 'conflict' ? { status: 'conflict' } : {}),
            ...(row.status === 'conflict' && recordedTrait ? { recordedTrait } : {}) });
        if (out.length >= 64) break;
    }
    return out;
}

function sanitizeNarrativeEpilogues(stored: unknown, incoming: unknown): Record<string, unknown>[] {
    const byChapter = new Map<string, Record<string, unknown>>();
    for (const source of [stored, incoming]) for (const raw of Array.isArray(source) ? source : []) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const chapterEventId = narrativeId(row.chapterEventId), lane = narrativeId(row.lane);
        if (!chapterEventId || !lane) continue;
        const prior = byChapter.get(chapterEventId);
        const status = row.status === 'seen' || prior?.status === 'seen' ? 'seen' : 'pending';
        const presentationTraits = Array.isArray(row.presentationTraits)
            ? [...new Set(row.presentationTraits.map((trait) => narrativeId(trait)).filter(Boolean))].slice(0, 96)
            : (prior?.presentationTraits ?? []);
        byChapter.set(chapterEventId, { version: 1, chapterEventId, lane: narrativeId(prior?.lane) || lane, status, presentationTraits });
        if (byChapter.size >= 8) break;
    }
    return [...byChapter.values()].slice(0, 8);
}

function sanitizeNarrativeScene(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const row = value as Record<string, unknown>, eventId = narrativeId(row.eventId);
    if (!eventId) return undefined;
    const history = (Array.isArray(row.history) ? row.history : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const cursor = raw as Record<string, unknown>;
        return [{ pageIndex: narrativeIndex(cursor.pageIndex, 999), lineIndex: narrativeIndex(cursor.lineIndex, 999) }];
    }).slice(-256);
    return { version: 1, eventId, pageIndex: narrativeIndex(row.pageIndex, 999), lineIndex: narrativeIndex(row.lineIndex, 999), history };
}

export function sanitizeNarrativeIdentity(
    char: Record<string, unknown>,
    exChar: Record<string, unknown>,
    inChar: Record<string, unknown>,
    existing: Record<string, unknown> | null | undefined,
    isFirstSave: boolean,
) {
    if (isFirstSave) delete char.activeStoryReckoning;
    // Field-route callbacks may only describe a completed server-recorded
    // journey. Client narrative receipts cannot manufacture another route.
    const fieldTraits = storyFieldTraits(exChar.storyFieldRecords);
    if (Array.isArray(char.storyTraits) || fieldTraits.length) {
        char.storyTraits = [...(Array.isArray(char.storyTraits) ? char.storyTraits : [])
            .filter((trait): trait is string => typeof trait === 'string' && !trait.startsWith('sf-')), ...fieldTraits];
    }
    // Narrative receipts carry no rewards or progression authority. Preserve
    // immutable decisions across stale authoritative responses, bound every
    // untrusted field, and let the ordinary save-version fence arbitrate
    // mutable pending-report/cursor state.
    char.storyChoices = sanitizeNarrativeChoices(exChar.storyChoices, char.storyChoices);
    char.pendingStoryReports = sanitizeNarrativeReports(
        Object.prototype.hasOwnProperty.call(inChar, 'pendingStoryReports') ? char.pendingStoryReports : exChar.pendingStoryReports,
    );
    char.storyEpilogues = sanitizeNarrativeEpilogues(exChar.storyEpilogues, char.storyEpilogues);
    const narrativeScene = sanitizeNarrativeScene(
        Object.prototype.hasOwnProperty.call(inChar, 'storyScene') ? char.storyScene : exChar.storyScene,
    );
    if (narrativeScene) char.storyScene = narrativeScene;
    else char.storyScene = null;

    // A combat specialty is a permanent character-creation identity. Legacy
    // style proof is attributed to this field, so allowing an ordinary client
    // save to rotate it would let one character manufacture progress in all
    // four disciplines. Accept one valid choice on the canonical first save;
    // thereafter the stored value always wins. Old malformed saves are healed
    // to Ninjutsu instead of preserving an attacker-controlled string.
    const combatSpecialties = new Set(['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu']);
    const storedSpecialty = typeof exChar.specialty === 'string' && combatSpecialties.has(exChar.specialty)
        ? exChar.specialty
        : null;
    const requestedSpecialty = typeof char.specialty === 'string' && combatSpecialties.has(char.specialty)
        ? char.specialty
        : null;
    char.specialty = isFirstSave
        ? (requestedSpecialty ?? 'Ninjutsu')
        : (storedSpecialty ?? 'Ninjutsu');

    // Optional, presentation-only recommendation preference. Unknown or retired
    // values safely fall back to Auto; older saves remain sparse until a player
    // actually chooses a focus.
    const savedMasteryFocus = char.masteryFocus ?? exChar.masteryFocus;
    if (savedMasteryFocus === undefined) delete char.masteryFocus;
    else char.masteryFocus = normalizeMasteryFocus(savedMasteryFocus);

    // Narrative-only Academy state. These fields carry no rewards or combat
    // authority, but they still cross an untrusted JSON boundary: keep the vow
    // on its three authored lanes and bound the recorded discovery sector so a
    // modified client cannot park arbitrary strings/objects in the save.
    const incomingAcademyVow = char.academyVow ?? exChar.academyVow;
    const storedAcademyVow = exChar.academyVow;
    if (incomingAcademyVow === "unbound" || incomingAcademyVow === "seeker" || incomingAcademyVow === "guardian") {
        char.academyVow = incomingAcademyVow;
    } else if (storedAcademyVow === "unbound" || storedAcademyVow === "seeker" || storedAcademyVow === "guardian") {
        char.academyVow = storedAcademyVow;
    } else {
        delete char.academyVow;
    }
    for (const flag of ["academyIncidentSeen", "academyFieldSeal"] as const) {
        if (Object.prototype.hasOwnProperty.call(char, flag)) char[flag] = char[flag] === true;
    }
    if (Object.prototype.hasOwnProperty.call(char, "academyTraceSector")) {
        char.academyTraceSector = Math.max(1, Math.min(10_000, Math.floor(Number(char.academyTraceSector) || 1)));
    }

    // ── Free-form user text moderation ──────────────────────────────
    // The DISPLAY name is player-authored too, and was capped nowhere: `safeName`
    // bounds the derived slug used in keys, but `character.name` rode through raw.
    // It renders in OTHER players' UI (leaderboards, sector nameplates, chat, clan
    // rosters), so an unbounded one breaks layout for everyone but its owner — a
    // griefing vector on a public launch. Registration now rejects over-long names
    // with a message; this is the authoritative backstop against a tampered client,
    // so it truncates silently rather than erroring. Length only: the name is NOT
    // re-derived from the slug, because a display name legitimately differs from it
    // ("Michael Corben" → michaelcorben).
    if (typeof char.name === 'string' && char.name.length > TEXT_LIMITS.playerName) {
        char.name = char.name.slice(0, TEXT_LIMITS.playerName);
    }
    // customTitle is the other character-level field a player can put
    // arbitrary text into. Mask profanity, redact PII, cap length so a
    // tampered save can't park a slur as their public title or stuff
    // a 10 KB string into the field. On top of the profanity mask
    // (docs/legacy-system-plan.md §11.4):
    //  • reserved authority/impersonation terms ("Admin", "Kage", "Server
    //    First", …) are rejected outright — the title clears to '';
    //  • EARNED-title strings ("Season Champion", legacy titles, era titles)
    //    are wearable only by players who actually own them — ownership is
    //    checked against the STORED character.legacy.titles (server-owned)
    //    plus earnedTitles (achievement grants, same trust level as
    //    achievements themselves).
    if (typeof char.customTitle === 'string' && char.customTitle.trim()) {
        // OLD behavior (always, every build): profanity mask + length cap.
        const masked = sanitizeUserText(char.customTitle, TEXT_LIMITS.customTitle);
        const storedTitle = String((existing?.character as Record<string, unknown> | undefined)?.customTitle ?? '');
        // NEW moderation (reserved terms + earned-title ownership) applies ONLY
        // when the Legacy system is live AND the title actually CHANGED. This
        // keeps flag-off behavior byte-identical, and — critically — never
        // re-confiscates a title a player already wears (an existing, unchanged
        // "Kage Slayer" is not re-evaluated). Verification finding.
        const titleChanged = masked !== storedTitle;
        const norm = normalizeTitleKey(masked);
        if (titleChanged && isServerCreditedTitle(masked)) {
            // ALWAYS-ON (deliberate flag-off exception): the legacy/era title
            // strings are server-granted only, and the changed-only grandfather
            // above is permanent — so a title squatted while ENABLE_LEGACY is
            // still off would survive the flag flip forever. A CHANGED title
            // can claim one of these strings only if the stored server-owned
            // vault already contains it. Verification finding.
            const storedLegacy = (existing?.character as Record<string, unknown> | undefined)?.legacy as { titles?: string[] } | undefined;
            const storedServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
            // Server-owned ownership: stored legacy.titles ∪ serverTitles
            // (both re-injected by this sanitizer, never client-mutable).
            const serverOwned = new Set([
                ...(Array.isArray(storedLegacy?.titles) ? storedLegacy!.titles! : []),
                ...(Array.isArray(storedServer) ? (storedServer as string[]) : []),
            ].map((t) => normalizeTitleKey(String(t))));
            char.customTitle = serverOwned.has(norm) ? masked : '';
        } else if (titleChanged && isKnownEarnedTitle(masked)) {
            // Achievement-title impersonation is blocked in every release flag
            // state. Only the stored server-synced vault can authorize it.
            const storedServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
            const owned = new Set([
                ...(Array.isArray(exChar.earnedTitles) ? (exChar.earnedTitles as string[]) : []).map((t) => normalizeTitleKey(String(t))),
                ...(Array.isArray(storedServer) ? (storedServer as string[]) : []).map((t) => normalizeTitleKey(String(t))),
            ]);
            char.customTitle = owned.has(norm) ? masked : '';
        } else if (legacyEnabled() && titleChanged) {
            char.customTitle = isAllowedCustomTitle(masked) ? masked : '';
        } else {
            char.customTitle = masked;
        }
    } else if (char.customTitle !== undefined && typeof char.customTitle !== 'string') {
        // Non-string tamper (array/object) would skip the whole gate above and
        // render raw client-controlled content — clear it. Verification finding.
        char.customTitle = '';
    }

    // Server-owned title vault (era Herald + any future server grant). Like
    // character.legacy, the STORED copy always wins so a tampered save can't
    // self-grant one; unlockEra (api/_era.ts) is the only writer.
    {
        const exServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
        if (Array.isArray(exServer)) char.serverTitles = exServer;
        else delete char.serverTitles;
    }

    // Custom-title cosmetics — allowlist only (TITLE_STYLE_IDS/TITLE_ICON_SET
    // in _titles-registry.ts, mirroring the client's lib/legacy.ts). Cosmetic;
    // anything off-list clamps to ''. Legacy-wave feature: while ENABLE_LEGACY
    // is off the fields are inert — the stored copy wins, so flag-off stays
    // byte-identical for saves that never had them and a temporary kill-switch
    // toggle can't strip an already-purchased style. Verification finding.
    if (legacyEnabled()) {
        if ('customTitleStyle' in char) {
            char.customTitleStyle = (typeof char.customTitleStyle === 'string' && TITLE_STYLE_IDS.has(char.customTitleStyle)) ? char.customTitleStyle : '';
        }
        if ('customTitleIcon' in char) {
            char.customTitleIcon = (typeof char.customTitleIcon === 'string' && TITLE_ICON_SET.has(char.customTitleIcon)) ? char.customTitleIcon : '';
        }
    } else {
        const exChar = existing?.character as Record<string, unknown> | undefined;
        if (typeof exChar?.customTitleStyle === 'string') char.customTitleStyle = exChar.customTitleStyle;
        else delete char.customTitleStyle;
        if (typeof exChar?.customTitleIcon === 'string') char.customTitleIcon = exChar.customTitleIcon;
        else delete char.customTitleIcon;
    }

    // ── Legacy (server-owned) ───────────────────────────────────────
    // character.legacy is written ONLY by the server (api/legacy/sage.ts /
    // api/legacy/trial.ts / api/admin/legacy.ts). Whatever the client
    // autosaves, the STORED copy wins — a tampered save can neither claim a
    // legacy, move a stage, nor grant itself legacy titles. (Admin saves
    // bypass this sanitizer like everything else here.)
    {
        const exLegacy = (existing?.character as Record<string, unknown> | undefined)?.legacy;
        if (exLegacy !== undefined) char.legacy = exLegacy;
        else delete char.legacy;
    }

    // ── Nindo (player-authored profile creed) ──────────────────────
    // BBCode subset, rendered SAFELY client-side by lib/nindo-bbcode (never raw
    // HTML). Server job here is storage hygiene: strip control chars, cap length,
    // and blank the whole creed if its visible text (tags stripped) trips the
    // profanity gate. We always WRITE a string when `nindo` is present in the
    // incoming save — so clearing it (empty string) actually persists through the
    // image-preserving merge instead of being treated as "field omitted".
    if ('nindo' in char) {
        const NINDO_MAX_LEN = 2000;
        let v = typeof char.nindo === 'string' ? char.nindo : '';
        v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, NINDO_MAX_LEN);
        const visibleText = v.replace(/\[\/?[a-z*]{1,8}(?:=[^\]\n]{0,256})?\]/gi, ' ');
        if (v.trim() && !isCleanText(visibleText)) v = '';
        char.nindo = v;
    }

    // Nindo banner preset — allowlist only (mirror lib/nindo-backgrounds
    // NINDO_BACKGROUND_IDS). Cosmetic; reject anything else to ''.
    if ('nindoBg' in char) {
        const NINDO_BG_IDS = new Set(['', 'ember', 'frost', 'verdant', 'shadow', 'royal', 'sakura']);
        char.nindoBg = (typeof char.nindoBg === 'string' && NINDO_BG_IDS.has(char.nindoBg)) ? char.nindoBg : '';
    }
}
