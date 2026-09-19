/**
 * Creator (admin-authored) content review for `npm run narrative:audit -- --content <export.json>`.
 * Reads a local export only; it never contacts the live store. It follows the runtime rules:
 *   - sources merge admin1, admin2, then the published content store; a later source wins
 *     (api/_admin-event-catalog.ts, App mergeById);
 *   - a reserved (built-in) id always plays the repository scene, and a stored copy only lends
 *     its artwork (lib/canonical-narrative.ts);
 *   - players receive only presentation-only VN events (lib/release-safe-content.ts); everything
 *     else is visible to admin accounts alone.
 * Stale copies of built-ins are reported and counted, but are not audited as live prose.
 */
import { isReservedNarrativeId } from '../shinobij.client/src/lib/canonical-narrative.ts';
import { isReleaseSafeClientEvent } from '../shinobij.client/src/lib/release-safe-content.ts';
import { storyToCreatorEvent, interludeToCreatorEvent } from '../shinobij.client/src/lib/story-trigger.ts';
import { storylines } from '../shinobij.client/src/data/storylines.ts';
import { storyInterludesByVillage } from '../shinobij.client/src/data/story-interludes.ts';
import { auraSphereLv9VnEvent, awakeningLv2VnEvent, craftDungeonEvents, hiddenDungeonVnEvent } from '../shinobij.client/src/data/vn-events.ts';
import { defaultAncientChestVn, defaultPetEncounterVn } from '../shinobij.client/src/data/default-vn-events.ts';
import type { CreatorEvent } from '../shinobij.client/src/types/vn.ts';
import type { Finding } from './narrative-audit.mts';
import type { Page, Scene } from './narrative-corpus.mts';

type Source = { name: string; events: unknown[]; vnConfigs: { id: string; field: string; value: unknown }[] };
export type CreatorInventoryRow = {
    id: string;
    name: string;
    source: string;
    kind: 'stale-builtin-copy' | 'current-builtin-copy' | 'reserved-unknown' | 'custom';
    visibility: 'player-visible' | 'admin-only' | 'inert (repository scene plays)';
    pages: number;
    note?: string;
};

// The system VN configs are stored beside creatorEvents as single objects.
const VN_CONFIG_FIELDS = [
    { field: 'petEncounterVn', id: 'sys-pet-encounter' },
    { field: 'ancientChestVn', id: 'sys-ancient-chest' },
] as const;

function record(name: string, value: unknown): Source {
    const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const unwrap = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? (v as { value: unknown }).value : v);
    const events = unwrap(r.creatorEvents);
    return {
        name,
        events: Array.isArray(events) ? events : [],
        vnConfigs: VN_CONFIG_FIELDS.flatMap(({ field, id }) => (unwrap(r[field]) ? [{ id, field, value: unwrap(r[field]) }] : [])),
    };
}

/** Accepts `[...events]`, `{creatorEvents: [...]}`, or `{slots: {admin1: {...}, admin2: {...}}, published: {...}}`.
 *  Published fields may be raw values or content-store records (`{field, version, value}`). */
export function creatorSources(raw: unknown): Source[] {
    if (Array.isArray(raw)) return [{ name: 'export', events: raw, vnConfigs: [] }];
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (obj.slots && typeof obj.slots === 'object') {
        const out = Object.entries(obj.slots as Record<string, unknown>).map(([name, slot]) => record(name, slot));
        if (obj.published && typeof obj.published === 'object') out.push(record('published', obj.published));
        return out;
    }
    if (Array.isArray(obj.creatorEvents)) return [record('export', obj)];
    throw new Error('Export must be an event array, {creatorEvents: [...]}, or {slots: {...}, published: {...}}');
}

/** Every built-in scene the audit can rebuild, keyed by the id a saved copy would carry. */
export function builtinNarrativeEvents(): Map<string, CreatorEvent> {
    const map = new Map<string, CreatorEvent>();
    for (const [village, steps] of Object.entries(storylines))
        steps.forEach((step, index) => { const event = storyToCreatorEvent(step, village, index); map.set(event.id, event); });
    for (const scenes of Object.values(storyInterludesByVillage))
        for (const scene of scenes) { const event = interludeToCreatorEvent(scene); map.set(event.id, event); }
    for (const event of [awakeningLv2VnEvent, auraSphereLv9VnEvent, hiddenDungeonVnEvent, ...craftDungeonEvents, defaultPetEncounterVn, defaultAncientChestVn])
        map.set(event.id, event);
    // Retired aliases of the system configs resolve to the same scene at runtime.
    map.set('pet-encounter', defaultPetEncounterVn);
    map.set('ancient-chest', defaultAncientChestVn);
    return map;
}

/** Only what a reader shows: titles, captions, speakers, lines, choices and results. */
function narrativeText(event: CreatorEvent): string {
    const pages = event.vnPages?.length ? event.vnPages : [{ title: event.vnTitle ?? event.name, scene: event.vnScene ?? '', speaker: event.vnSpeaker ?? '', dialogue: event.dialogue ?? [] }];
    return JSON.stringify(pages.map(p => [p.title, p.scene, p.speaker, p.lines?.map(l => [l.speaker, l.text]) ?? p.dialogue, (p.choices ?? []).map(c => [c.text, c.conclusion ?? '', c.nextPage ?? null])]));
}

function eventPages(event: CreatorEvent): Page[] {
    return (event.vnPages?.length
        ? event.vnPages
        : [{ title: event.vnTitle ?? event.name, scene: event.vnScene ?? '', speaker: event.vnSpeaker ?? '', dialogue: event.dialogue ?? [] }]) as Page[];
}

/** Terms from the pre-rebuild drafts (found in the live admin slots, 2026-09-18) that
 *  current canon retired outright. Names the rebuild kept with new meanings, such as
 *  Storm Engine, Hollow Moon or Frost Seal Echo, are deliberately not listed. */
export const RETIRED_CANON_TERMS: readonly RegExp[] = [/\bFrost Echo\b/i, /\bHollow Gate Pact\b/i, /\bHollow Gate Echo\b/i, /\bThousand Gates\b/i, /\bchosen one\b/i];

export function auditCreatorExport(raw: unknown, input: string, builtins = builtinNarrativeEvents()) {
    const findings: Finding[] = [];
    const report = (severity: Finding['severity'], code: string, scene: string, detail: string) => findings.push({ severity, code, scene, detail });
    const effective = new Map<string, { event: CreatorEvent; source: string }>();
    const sources = creatorSources(raw);
    let stored = 0;
    for (const source of sources) {
        const seen = new Set<string>();
        const entries = [
            ...source.events.map((value, index) => ({ value, where: `${source.name}/creatorEvents[${index}]` })),
            ...source.vnConfigs.map(({ value, field, id }) => ({ value: { ...(value as object), id }, where: `${source.name}/${field}` })),
        ];
        for (const { value, where } of entries) {
            stored++;
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                report('error', 'creator-malformed', where, 'Expected an event object');
                continue;
            }
            const event = value as CreatorEvent;
            const id = typeof event.id === 'string' ? event.id.trim() : '';
            if (!id || id.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(id)) {
                report('error', 'creator-invalid-id', where, `${JSON.stringify(event.id)}: the server catalog drops events without a safe id`);
                continue;
            }
            // The system configs share an id with any creatorEvents copy of the same scene;
            // they are separate stores, so only compare events with events.
            const key = where.includes('/creatorEvents[') ? id : `${id}#config`;
            if (seen.has(key))
                report('error', 'creator-duplicate-id', where, `${id} appears twice in ${source.name}; only the later copy survives the merge`);
            seen.add(key);
            const previous = effective.get(key);
            if (previous && narrativeText(previous.event) !== narrativeText(event))
                report('warning', 'creator-shadowed-copy', where, `${id}: ${source.name} replaces a different ${previous.source} copy`);
            effective.set(key, { event, source: where });
        }
    }
    const scenes: Scene[] = [];
    const inventory: CreatorInventoryRow[] = [];
    for (const [key, { event, source }] of effective) {
        const id = key.replace(/#config$/, '');
        const pages = eventPages(event);
        if (isReservedNarrativeId(id)) {
            const base = builtins.get(id);
            if (!base) {
                inventory.push({ id, name: event.name, source, kind: 'reserved-unknown', visibility: 'inert (repository scene plays)', pages: pages.length });
                report('warning', 'creator-reserved-id', source, `${id} uses a built-in id the audit cannot rebuild. Custom scenes need a custom id, or no trigger will ever play them.`);
                continue;
            }
            const stale = narrativeText(event) !== narrativeText(base);
            const differing = stale ? eventPages(event).filter((page, index) => JSON.stringify(page.dialogue) !== JSON.stringify(eventPages(base)[index]?.dialogue)).length : 0;
            const retired = RETIRED_CANON_TERMS.filter(term => term.test(narrativeText(event))).map(term => term.source.replace(/\\b/g, ''));
            inventory.push({
                id, name: event.name, source, kind: stale ? 'stale-builtin-copy' : 'current-builtin-copy', visibility: 'inert (repository scene plays)', pages: pages.length,
                note: stale ? `${pages.length} stored pages vs ${eventPages(base).length} current; ${differing} stored pages differ${retired.length ? `; retired lore: ${retired.join(', ')}` : ''}` : undefined,
            });
            if (stale)
                report('warning', 'creator-stale-builtin', source, `${id}: players get the repository scene; this stored copy only lends artwork. ${inventory.at(-1)!.note}`);
            continue;
        }
        const visible = isReleaseSafeClientEvent(event);
        inventory.push({ id, name: event.name, source, kind: 'custom', visibility: visible ? 'player-visible' : 'admin-only', pages: pages.length });
        scenes.push({
            id: `creator/${id}`, family: 'creator', source: `${input}#${source}`, graph: true, pages,
            context: `${event.name}; ${visible ? 'player-visible' : 'admin-only (rewards, battles, traits, finale or non-VN kind)'}; trigger ${event.trigger || 'level'}; L${event.levelReq}`,
        });
        const text = [event.name, event.vnTitle, event.vnScene, ...pages.flatMap(p => [p.title, p.scene, ...(p.lines?.map(l => l.text) ?? p.dialogue ?? []), ...(p.choices ?? []).flatMap(c => [c.text, c.conclusion])])].filter((t): t is string => typeof t === 'string');
        for (const line of text) {
            if (/\badmin event\b|\blorem ipsum\b|\b(?:TODO|TBD|FIXME)\b|\bplaceholder\b/i.test(line))
                report('error', 'creator-placeholder', `creator/${id}`, line);
            else if (/\btest(?:ing)?\b/i.test(line))
                report('warning', 'creator-test-content', `creator/${id}`, line);
        }
    }
    const count = (kind: CreatorInventoryRow['kind']) => inventory.filter(row => row.kind === kind).length;
    const summary = {
        sources: sources.map(s => ({ name: s.name, events: s.events.length, vnConfigs: s.vnConfigs.length })),
        storedEntries: stored,
        effectiveEntries: inventory.length,
        staleBuiltinCopies: count('stale-builtin-copy'),
        currentBuiltinCopies: count('current-builtin-copy'),
        reservedUnknown: count('reserved-unknown'),
        custom: count('custom'),
        customPlayerVisible: inventory.filter(row => row.kind === 'custom' && row.visibility === 'player-visible').length,
        customAdminOnly: inventory.filter(row => row.kind === 'custom' && row.visibility === 'admin-only').length,
    };
    return { scenes, findings, inventory, summary };
}
