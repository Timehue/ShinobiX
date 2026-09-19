import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildCorpus, supplementalSources, narrativeConsumers, type Scene, type Page } from './narrative-corpus.mts';
import { splitDialogueLine } from '../shinobij.client/src/lib/vn.ts';
export type Finding = {
    severity: 'error' | 'warning';
    code: string;
    scene: string;
    detail: string;
};
const placeholders = new Set(['player', 'name', 'pet', 'element', 'village', 'sector', 'riftRecord']);
export function auditScenes(scenes: Scene[]): Finding[] {
    const findings: Finding[] = [];
    const report = (severity: Finding['severity'], code: string, scene: string, detail: string) => findings.push({ severity, code, scene, detail });
    const ids = new Set<string>();
    const repeated = new Map<string, Set<string>>();
    for (const s of scenes) {
        if (ids.has(s.id))
            report('error', 'duplicate-scene', s.id, 'Duplicate inventory identity');
        ids.add(s.id);
        if (!s.pages.length)
            report('error', 'empty-scene', s.id, 'No pages');
        const pageIds = new Set<string>();
        for (const [i, p] of s.pages.entries()) {
            const where = `${s.id}/page-${i}`;
            if (!p || typeof p !== 'object') {
                report('error', 'malformed-page', where, 'Expected a page object');
                continue;
            }
            for (const key of ['title', 'scene', 'speaker'] as const)
                if (typeof p[key] !== 'string' || !p[key].trim())
                    report('error', `missing-${key}`, where, `Missing ${key}`);
            const pageId = (p as Page & {
                id?: string;
            }).id;
            if (pageId) {
                if (pageIds.has(pageId))
                    report('error', 'duplicate-page', where, pageId);
                pageIds.add(pageId);
            }
            if (!Array.isArray(p.dialogue) || !p.dialogue.length)
                report('error', 'empty-dialogue', where, 'No dialogue');
            const visible = p.lines?.map(l => l.text) ?? p.dialogue ?? [];
            if (p.lines) {
                if (p.lines.length !== p.dialogue?.length)
                    report('error', 'typed-line-mirror', where, 'Typed and legacy line counts differ');
                for (const l of p.lines)
                    if (!l.speaker?.trim())
                        report('error', 'missing-speaker', where, 'Typed line lacks speaker');
            }
            for (const text of [...visible, ...(p.choices ?? []).flatMap(c => [c.text, ...(c.conclusion ? [c.conclusion] : [])])]) {
                if (typeof text !== 'string' || !text.trim()) {
                    report('error', 'empty-line', where, 'Blank line or choice');
                    continue;
                }
                if (/\b(?:TODO|FIXME|lorem ipsum|INSERT (?:TEXT|DIALOGUE)|undefined|NaN)\b/i.test(text))
                    report('error', 'placeholder', where, text);
                if (/\$\{|\{\{|\}\}/.test(text) || (text.match(/\{/g)?.length ?? 0) !== (text.match(/\}/g)?.length ?? 0))
                    report('error', 'interpolation', where, text);
                for (const token of text.matchAll(/\{([^{}]+)\}/g))
                    if (!placeholders.has(token[1]))
                        report('error', 'unknown-variable', where, token[0]);
                for (const token of text.matchAll(/%([a-zA-Z]+)/g))
                    if (!['name', 'pet'].includes(token[1]))
                        report('error', 'unknown-variable', where, token[0]);
                if (/[\u2013\u2014]|[.!?]{3,}/u.test(text))
                    report('warning', 'punctuation', where, text);
                if (text.trim().split(/\s+/).length <= 3)
                    report('warning', 'short-line', where, text);
                if (/(?:soul|bloodline|ancestor|destiny|chosen one)/i.test(text))
                    report('warning', 'canon-review', where, text);
                if (/\b(?:the silence|the road|the wind|the storm)\b.{0,30}\b(?:remembers|knows|owes|answers|understands)\b/i.test(text))
                    report('warning', 'metaphor-review', where, text);
                const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                if (normalized.length > 75) {
                    const found = repeated.get(normalized) ?? new Set();
                    found.add(s.id);
                    repeated.set(normalized, found);
                }
            }
            const choiceIds = new Set<string>();
            for (const [cIndex, c] of (p.choices ?? []).entries()) {
                const id = (c as {
                    id?: string;
                }).id;
                if (id) {
                    if (choiceIds.has(id))
                        report('error', 'duplicate-choice', where, id);
                    choiceIds.add(id);
                }
                if (c.requireTrait && c.requireTrait === c.forbidTrait)
                    report('error', 'impossible-gate', where, `Choice ${cIndex}: ${c.requireTrait} both required and forbidden`);
                if (s.graph && (!Number.isInteger(c.nextPage) || c.nextPage! < 0 || c.nextPage! >= s.pages.length))
                    report('error', 'branch-reference', where, `Choice ${cIndex} targets ${c.nextPage}; page count ${s.pages.length}`);
            }
        }
        if (s.graph && !findings.some(f => f.severity === 'error' && f.scene.startsWith(`${s.id}/`)))
            auditGraph(s, report);
    }
    for (const [line, locations] of repeated)
        if (locations.size >= 3)
            report('warning', 'repeated-line', [...locations][0], `${locations.size} scenes: ${line}`);
    return findings;
}
// Gate states are explored symbolically. A state tracks only facts needed by
// its path; requiring/forbidding an incoming trait refines that state. Granted
// traits cannot be wished away on a later choice. Reachability and reverse
// reachability find orphan pages and closed loops without rejecting valid hubs.
function auditGraph(s: Scene, report: (severity: Finding['severity'], code: string, scene: string, detail: string) => void) {
    const gateTraits = new Set(s.pages.flatMap(p => (p.choices ?? []).flatMap(c => [c.requireTrait, c.forbidTrait].filter((t): t is string => !!t))));
    // Most authored hubs have an unconditional exit. Prove that every page can
    // finish for EVERY trait assignment first. In that case symbolic exploration
    // only needs a witness path to each page, not every permutation of hub visits.
    const alwaysFinishes = new Set<number>();
    let growing = true;
    while (growing) {
        growing = false;
        for (const [i, p] of s.pages.entries()) {
            if (alwaysFinishes.has(i))
                continue;
            const choices = p.choices ?? [];
            const safe = !choices.length ? (i === s.pages.length - 1 || alwaysFinishes.has(i + 1)) : choices.some(c => !c.requireTrait && !c.forbidTrait && (c.battle || c.nextPage === i || alwaysFinishes.has(c.nextPage!)));
            if (safe) {
                alwaysFinishes.add(i);
                growing = true;
            }
        }
    }
    type State = {
        page: number;
        yes: Set<string>;
        no: Set<string>;
        edges: Set<string>;
        terminal: boolean;
    };
    const states = new Map<string, State>(), queue: string[] = [], reached = new Set<number>();
    const key = (page: number, yes: Set<string>, no: Set<string>) => `${page}|${[...yes].sort()}|${[...no].sort()}`;
    const add = (page: number, yes: Set<string>, no: Set<string>) => {
        const id = key(page, yes, no);
        if (!states.has(id)) {
            states.set(id, { page, yes, no, edges: new Set(), terminal: false });
            queue.push(id);
        }
        return id;
    };
    add(0, new Set(), new Set());
    for (let cursor = 0; cursor < queue.length; cursor++) {
        if (queue.length > 50000) {
            report('error', 'graph-budget', s.id, 'More than 50,000 gate states; simplify or extend the checker explicitly.');
            return;
        }
        const state = states.get(queue[cursor])!;
        reached.add(state.page);
        if (alwaysFinishes.size === s.pages.length && reached.size === s.pages.length)
            return;
        const p = s.pages[state.page];
        const choices = p.choices ?? [];
        if (!choices.length) {
            if (state.page === s.pages.length - 1)
                state.terminal = true;
            else
                state.edges.add(add(state.page + 1, new Set(state.yes), new Set(state.no)));
            continue;
        }
        for (const c of choices) {
            if (c.requireTrait && state.no.has(c.requireTrait) || c.forbidTrait && state.yes.has(c.forbidTrait))
                continue;
            const yes = new Set(state.yes), no = new Set(state.no);
            if (c.requireTrait)
                yes.add(c.requireTrait);
            if (c.forbidTrait)
                no.add(c.forbidTrait);
            if (c.trait && gateTraits.has(c.trait)) {
                yes.add(c.trait);
                no.delete(c.trait);
            }
            if (c.battle || c.nextPage === state.page)
                state.terminal = true;
            else
                state.edges.add(add(c.nextPage!, yes, no));
        }
        // Is there an incoming assignment that hides EVERY choice? Solve the small
        // conjunction of each choice's negated visibility. A true result is a dead end.
        const canHideAll = (index: number, yes: Set<string>, no: Set<string>): boolean => {
            if (index === choices.length)
                return true;
            const c = choices[index];
            if (c.requireTrait && !yes.has(c.requireTrait)) {
                const n = new Set(no);
                n.add(c.requireTrait);
                if (canHideAll(index + 1, yes, n))
                    return true;
            }
            if (c.forbidTrait && !no.has(c.forbidTrait)) {
                const y = new Set(yes);
                y.add(c.forbidTrait);
                if (canHideAll(index + 1, y, no))
                    return true;
            }
            return false;
        };
        if (canHideAll(0, state.yes, state.no))
            report('error', 'gated-dead-end', `${s.id}/page-${state.page}`, 'Some reachable trait assignment hides every choice.');
    }
    const exits = new Set([...states].filter(([, s]) => s.terminal).map(([id]) => id));
    let changed = true;
    while (changed) {
        changed = false;
        for (const [id, state] of states)
            if (!exits.has(id) && [...state.edges].some(e => exits.has(e))) {
                exits.add(id);
                changed = true;
            }
    }
    for (const [id, state] of states)
        if (!exits.has(id))
            report('error', 'closed-branch', `${s.id}/page-${state.page}`, 'This reachable branch cannot reach completion.');
    for (let i = 0; i < s.pages.length; i++)
        if (!reached.has(i))
            report('error', 'unreachable-page', s.id, `Page ${i}: ${s.pages[i].title}`);
}
export function sampleScenes(scenes: Scene[], count: number, seed: number): Scene[] {
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const shuffle = <T>(values: T[]) => {
        for (let i = values.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [values[i], values[j]] = [values[j], values[i]];
        }
        return values;
    };
    const result: Scene[] = [];
    // Every family plus all four villages, with a random scene within each stratum.
    const strata = [...new Set(scenes.map(s => s.family))].map(f => scenes.filter(s => s.family === f));
    for (const village of [...new Set(scenes.filter(s => s.family === 'campaign').map(s => s.village))])
        strata.push(scenes.filter(s => s.family === 'campaign' && s.village === village));
    for (const pool of strata) {
        const s = shuffle([...pool]).find(s => !result.includes(s));
        if (s)
            result.push(s);
    }
    for (const s of shuffle([...scenes]))
        if (result.length < Math.max(count, strata.length) && !result.includes(s))
            result.push(s);
    return result;
}
export function renderScene(s: Scene): string {
    return [`# ${s.id}`, `Source: ${s.source}`, `Context: ${s.context}`, ...s.pages.flatMap((p, i) => [
            `\n[${i}] ${p.title} | ${p.speaker}`, `Scene: ${p.scene}`,
            ...(p.requireTrait || p.forbidTrait ? [`Page gate: requires ${p.requireTrait ?? 'none'}, forbids ${p.forbidTrait ?? 'none'}`] : []),
            ...(p.lines ? p.lines.map(l => `${l.speaker}: ${l.text}`) : p.dialogue.map(l => { const line = splitDialogueLine(l, p.speaker); return `${line.speaker}: ${line.text}`; })),
            ...(p.choices ?? []).map(c => `> ${c.text} [next ${c.nextPage ?? 'end'}; requires ${c.requireTrait ?? 'none'}; forbids ${c.forbidTrait ?? 'none'}; grants ${c.trait ?? 'none'}${c.battle ? '; battle' : ''}]${c.conclusion ? `\n  Result: ${c.conclusion}` : ''}`),
        ])].join('\n');
}
export function sourceProse(file: string): {
    line: number;
    text: string;
}[] {
    const raw = readFileSync(file, 'utf8'), source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS), out: {
        line: number;
        text: string;
    }[] = [];
    const walk = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isJsxText(node)) {
            const text = ts.isTemplateExpression(node) ? node.getText(source) : node.text;
            if (text.length >= 28 && /[a-z]{2} [a-z]{2}/i.test(text) && !/^\/?(?:assets|scenes|portraits|https?:|\.\.)/.test(text) && !text.includes('className='))
                out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text });
            if (ts.isTemplateExpression(node))
                return;
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return out;
}
function sourceFiles(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap(e => {
        const file = `${root}/${e.name}`;
        if (e.isDirectory())
            return /^(?:assets|generated|node_modules|dist)$/.test(e.name) ? [] : sourceFiles(file);
        return /\.tsx?$/.test(e.name) && !/(?:\.test\.|\.spec\.|\.d\.ts$)/.test(e.name) ? [file] : [];
    });
}
function main() {
    const args = process.argv.slice(2), option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
    if (args.includes('--help')) {
        console.log('npm run narrative:audit -- [--out .tmp/narrative-audit] [--sample 24 --seed 20260919] [--content local-admin-export.json]\nErrors fail. Warnings require contextual review; they never rewrite prose. Local exports are read only.');
        return;
    }
    const scenes = buildCorpus();
    const input = option('--content');
    if (input) {
        const raw = JSON.parse(readFileSync(input, 'utf8'));
        const events = Array.isArray(raw) ? raw : raw.creatorEvents;
        if (!Array.isArray(events))
            throw new Error('Export must be an event array or {creatorEvents: [...]}');
        for (const [i, e] of events.entries())
            scenes.push({ id: `external/${e.id ?? i}`, family: 'external', source: input, context: e.name ?? 'Local exported event', graph: true, pages: e.vnPages ?? [{ title: e.vnTitle ?? e.name, scene: e.vnScene, speaker: e.vnSpeaker, dialogue: e.dialogue }] });
    }
    const findings = auditScenes(scenes), sources = [...new Set([...scenes.map(s => s.source), ...supplementalSources, 'shinobij.client/src/data/hollow-rifts.ts'])];
    const supplemental = supplementalSources.map(file => ({ file, prose: sourceProse(file) }));
    // Deliberately advisory: this broad discovery also finds readers and interfaces.
    // New producers outside the registry should never silently escape the audit.
    const candidates = [...sourceFiles('shinobij.client/src'), ...sourceFiles('shared'), ...sourceFiles('api')].filter(file => !sources.includes(file) && !narrativeConsumers.includes(file) && /\b(?:dialogue|vnPages|greeting)\s*:/.test(readFileSync(file, 'utf8')));
    for (const file of candidates)
        findings.push({ severity: 'warning', code: 'uncatalogued-source', scene: file, detail: 'Inspect whether this is a narrative producer, a transport, or a reader.' });
    const dir = resolve(option('--out') ?? '.tmp/narrative-audit');
    mkdirSync(dir, { recursive: true });
    const displayedLines = scenes.filter(s => !s.catalog).flatMap(s => s.pages).flatMap(p => p.lines ?? (p.dialogue ?? []).map(text => splitDialogueLine(text, p.speaker ?? '')));
    const codes = ['duplicate-scene', 'duplicate-page', 'duplicate-choice', 'branch-reference', 'unreachable-page', 'closed-branch', 'gated-dead-end', 'missing-speaker', 'empty-dialogue', 'placeholder', 'interpolation', 'unknown-variable', ...findings.map(f => f.code)];
    const summary = {
        scenes: scenes.length,
        sceneVariants: scenes.filter(s => !s.catalog).length,
        catalogEntries: scenes.filter(s => s.catalog).length,
        dialogueLines: displayedLines.filter(l => l.speaker.toLowerCase() !== 'narrator').length,
        narrationLines: displayedLines.filter(l => l.speaker.toLowerCase() === 'narrator').length,
        catalogTextLines: scenes.filter(s => s.catalog).flatMap(s => s.pages).reduce((n, p) => n + (p.dialogue?.length ?? 0), 0),
        families: Object.fromEntries([...new Set(scenes.map(s => s.family))].map(f => [f, scenes.filter(s => s.family === f).length])),
        errors: findings.filter(f => f.severity === 'error').length,
        warnings: findings.filter(f => f.severity === 'warning').length,
        findingsByCode: Object.fromEntries([...new Set(codes)].map(code => [code, findings.filter(f => f.code === code).length])),
        supplementalSourceFiles: supplemental.length,
        supplementalProseLiterals: supplemental.reduce((n, s) => n + s.prose.length, 0),
        note: 'Counts include alternative and repeated variants, not unique scenes experienced by one player. Dialogue includes tutorial instructions; catalog labels/copy are separate. Supplemental AST extracts are review aids, not executed coverage or additional scene counts.',
    };
    writeFileSync(`${dir}/report.json`, JSON.stringify({ summary, findings, sources, sceneIndex: scenes.map(({ pages, ...rest }) => ({ ...rest, pages: pages.length })) }, null, 2));
    writeFileSync(`${dir}/supplemental.txt`, supplemental.map(s => `# ${s.file}\n${s.prose.map(p => `${p.line}: ${p.text}`).join('\n')}`).join('\n\n'));
    if (option('--sample')) {
        const seed = Number(option('--seed') ?? 20260919), sample = sampleScenes(scenes, Number(option('--sample')), seed);
        writeFileSync(`${dir}/sample-${seed}.txt`, sample.map(renderScene).join('\n\n'));
        writeFileSync(`${dir}/sample-${seed}.json`, JSON.stringify({ seed, ids: sample.map(s => s.id) }, null, 2));
        console.log(`Sample: ${sample.length} complete scenes, seed ${seed}`);
    }
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Details: ${relative(process.cwd(), dir)}/report.json`);
    for (const f of findings.filter(f => f.severity === 'error').slice(0, 30))
        console.error(`${f.code}: ${f.scene}: ${f.detail}`);
    if (summary.errors)
        process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main();
