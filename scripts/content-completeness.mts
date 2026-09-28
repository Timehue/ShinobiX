/*
 * Content completeness lint.
 *
 * Walks every static content catalog the game ships (jutsu, legacy jutsu,
 * items, bloodlines, pets, Chronicle cards, wanderer voices) and reports
 * entries a player would meet half-finished: blank descriptions, missing
 * battle text, art paths that point at no file, duplicate ids.
 *
 * Findings come in two severities:
 *   - "error": always wrong (a referenced file that does not exist, a blank
 *     name, a duplicate id). The test fails on any of these.
 *   - "gap":   content that is shippable but unfinished (an item with no art
 *     yet). Known gaps live in content-completeness-baseline.json; the test
 *     fails when a NEW gap appears, and also when a baselined gap is fixed but
 *     still listed, so the baseline only ever shrinks.
 *
 * Run `node --import tsx scripts/content-completeness.mts` for a report, or
 * `... --write-baseline` to rewrite the baseline after fixing gaps.
 * Admin-authored content lives in KV, not here, and is out of scope.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { starterJutsus, starterSavedBloodlines } from '../shinobij.client/src/data/jutsu.ts';
import { LEGACY_JUTSU_DEFS } from '../shinobij.client/src/data/legacy-jutsu.ts';
import { starterItems } from '../shinobij.client/src/data/starter-items.ts';
import { eventItems } from '../shinobij.client/src/data/event-items.ts';
import { rawPetPool } from '../shinobij.client/src/data/pet-pool.ts';
import { CHRONICLE_CARD_CATALOG } from '../shared/chronicle-duel.ts';
import { WANDERER_ARCHETYPES } from '../shared/wanderer-roster.ts';
import { BREEDING_MYTHIC_POSE_ALIASES } from '../shinobij.client/src/lib/pet-battle-anim.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'shinobij.client', 'public');
export const BASELINE_PATH = join(ROOT, 'scripts', 'content-completeness-baseline.json');

/** Shortest text that still reads as a sentence rather than a placeholder. */
export const MIN_TEXT_LENGTH = 10;

export type Severity = 'error' | 'gap';
export interface Finding {
    severity: Severity;
    /** `<catalog>:<id>:<code>` — stable, so the baseline can list it. */
    key: string;
    message: string;
}

type Entry = Record<string, unknown>;

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** True when a root-relative asset path resolves to a shipped file. Inline
 *  data URIs and remote URLs are not ours to check. */
export function publicAssetExists(path: string, publicDir: string = PUBLIC_DIR): boolean {
    if (!path.startsWith('/') || path.startsWith('//')) return true;
    return existsSync(join(publicDir, decodeURI(path.split(/[?#]/)[0]).replace(/^\/+/, '')));
}

function finding(severity: Severity, catalog: string, id: string, code: string, message: string): Finding {
    return { severity, key: `${catalog}:${id}:${code}`, message: `${catalog} "${id}": ${message}` };
}

function checkDuplicateIds(catalog: string, ids: string[]): Finding[] {
    const seen = new Set<string>();
    const out: Finding[] = [];
    for (const id of ids) {
        if (seen.has(id)) out.push(finding('error', catalog, id, 'duplicate-id', 'id appears more than once'));
        seen.add(id);
    }
    return out;
}

function checkName(catalog: string, id: string, value: unknown): Finding[] {
    return text(value) ? [] : [finding('error', catalog, id, 'missing-name', 'name is blank')];
}

function checkText(catalog: string, id: string, field: string, value: unknown, severity: Severity = 'error'): Finding[] {
    const v = text(value);
    if (!v) return [finding(severity, catalog, id, `missing-${field}`, `${field} is blank`)];
    if (v.length < MIN_TEXT_LENGTH) return [finding(severity, catalog, id, `short-${field}`, `${field} is only "${v}"`)];
    return [];
}

function checkArt(catalog: string, id: string, image: unknown, publicDir: string): Finding[] {
    const path = text(image);
    if (!path) return [];
    return publicAssetExists(path, publicDir)
        ? []
        : [finding('error', catalog, id, 'art-file-missing', `art "${path}" is not in shinobij.client/public`)];
}

export function auditJutsu(list: readonly Entry[], catalog: string, publicDir = PUBLIC_DIR): Finding[] {
    const out = checkDuplicateIds(catalog, list.map((j) => text(j.id)));
    for (const j of list) {
        const id = text(j.id) || '(no id)';
        out.push(...checkName(catalog, id, j.name));
        out.push(...checkText(catalog, id, 'battleDescription', j.battleDescription));
        out.push(...checkText(catalog, id, 'description', j.description, 'gap'));
        out.push(...checkArt(catalog, id, j.image, publicDir));
    }
    return out;
}

export function auditItems(list: readonly Entry[], catalog: string, publicDir = PUBLIC_DIR): Finding[] {
    const out = checkDuplicateIds(catalog, list.map((i) => text(i.id)));
    for (const item of list) {
        const id = text(item.id) || '(no id)';
        out.push(...checkName(catalog, id, item.name));
        out.push(...checkText(catalog, id, 'description', item.description));
        if (!text(item.image)) out.push(finding('gap', catalog, id, 'no-art', 'has no art yet'));
        out.push(...checkArt(catalog, id, item.image, publicDir));
    }
    return out;
}

export function auditBloodlines(list: readonly Entry[], publicDir = PUBLIC_DIR): Finding[] {
    const catalog = 'bloodline';
    const out = checkDuplicateIds(catalog, list.map((b) => text(b.name)));
    for (const b of list) {
        const id = text(b.name) || '(no name)';
        if (!text(b.image)) out.push(finding('gap', catalog, id, 'no-art', 'has no art yet'));
        out.push(...checkArt(catalog, id, b.image, publicDir));
    }
    return out;
}

export function auditPets(list: readonly Entry[], publicDir = PUBLIC_DIR, poseAliases: Readonly<Record<string, string>> = BREEDING_MYTHIC_POSE_ALIASES): Finding[] {
    const catalog = 'pet';
    const out = checkDuplicateIds(catalog, list.map((p) => text(p.id)));
    for (const p of list) {
        const id = text(p.id) || '(no id)';
        out.push(...checkName(catalog, id, p.name));
        out.push(...checkText(catalog, id, 'description', p.description));
        // Pet art is found by convention (lib/pet-battle-anim.ts), not by a
        // catalog field — the idle pose is the one every battle view needs. A
        // breeding-only Mythic may deliberately borrow another pet's pose sheet
        // (BREEDING_MYTHIC_POSE_ALIASES); that counts, as long as it exists.
        const poseId = poseAliases[id] ?? id;
        if (!publicAssetExists(`/pet-poses/${poseId}-idle.webp`, publicDir)) {
            out.push(finding('gap', catalog, id, 'no-idle-pose', `no /pet-poses/${id}-idle.webp yet`));
        }
    }
    return out;
}

export function auditChronicleCards(list: readonly Entry[], publicDir = PUBLIC_DIR): Finding[] {
    const catalog = 'card';
    const out = checkDuplicateIds(catalog, list.map((c) => text(c.id)));
    for (const c of list) {
        const id = text(c.id) || '(no id)';
        out.push(...checkName(catalog, id, c.name));
        out.push(...checkText(catalog, id, 'lore', c.lore));
        if (!text(c.image)) out.push(finding('gap', catalog, id, 'no-art', 'has no art yet'));
        out.push(...checkArt(catalog, id, c.image, publicDir));
    }
    return out;
}

export function auditWandererVoices(archetypes: Record<string, { names: string[]; greetings: string[] }>): Finding[] {
    const out: Finding[] = [];
    for (const [id, meta] of Object.entries(archetypes)) {
        if (!meta.names.length || meta.names.some((n) => !text(n))) {
            out.push(finding('error', 'wanderer', id, 'blank-name', 'has a blank or missing name'));
        }
        if (!meta.greetings.length) out.push(finding('error', 'wanderer', id, 'no-greeting', 'has no greeting'));
        meta.greetings.forEach((g, i) => out.push(...checkText('wanderer', `${id}#${i}`, 'greeting', g)));
    }
    return out;
}

/** Every finding across the shipped catalogs, sorted by key. */
export function auditAllContent(publicDir: string = PUBLIC_DIR): Finding[] {
    const findings = [
        ...auditJutsu(starterJutsus as unknown as Entry[], 'jutsu', publicDir),
        ...auditJutsu(LEGACY_JUTSU_DEFS.map((d) => d.jutsu) as unknown as Entry[], 'legacy-jutsu', publicDir),
        ...auditItems(starterItems as unknown as Entry[], 'item', publicDir),
        ...auditItems(eventItems as unknown as Entry[], 'event-item', publicDir),
        ...auditBloodlines(starterSavedBloodlines as unknown as Entry[], publicDir),
        ...auditPets(rawPetPool as unknown as Entry[], publicDir),
        ...auditChronicleCards(CHRONICLE_CARD_CATALOG as unknown as Entry[], publicDir),
        ...auditWandererVoices(WANDERER_ARCHETYPES),
    ];
    return findings.sort((a, b) => a.key.localeCompare(b.key));
}

export function readBaseline(path: string = BASELINE_PATH): string[] {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { knownGaps?: unknown };
    return Array.isArray(parsed.knownGaps) ? parsed.knownGaps.map(String) : [];
}

/** Compare the live gaps with the baseline: `added` are new gaps (fix them or
 *  consciously baseline them), `fixed` are baselined gaps that no longer exist
 *  (delete them from the baseline so they cannot silently come back). */
export function diffAgainstBaseline(findings: Finding[], baseline: string[]) {
    const gaps = new Set(findings.filter((f) => f.severity === 'gap').map((f) => f.key));
    const known = new Set(baseline);
    return {
        added: [...gaps].filter((k) => !known.has(k)).sort(),
        fixed: [...known].filter((k) => !gaps.has(k)).sort(),
    };
}

function main() {
    const findings = auditAllContent();
    if (process.argv.includes('--write-baseline')) {
        const knownGaps = findings.filter((f) => f.severity === 'gap').map((f) => f.key);
        writeFileSync(BASELINE_PATH, `${JSON.stringify({ knownGaps }, null, 4)}\n`);
        console.log(`Wrote ${knownGaps.length} known gaps to ${BASELINE_PATH}`);
        return;
    }
    const errors = findings.filter((f) => f.severity === 'error');
    const { added, fixed } = diffAgainstBaseline(findings, readBaseline());
    for (const f of findings) console.log(`${f.severity.padEnd(5)} ${f.message}`);
    console.log(`\n${errors.length} error(s), ${findings.length - errors.length} gap(s); ${added.length} new, ${fixed.length} fixed since baseline.`);
    if (errors.length || added.length || fixed.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
