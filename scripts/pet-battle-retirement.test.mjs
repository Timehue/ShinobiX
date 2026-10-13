import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = resolve(root, 'shinobij.client');
const retired = new Set([
    'src/petvfx-legacy.tsx',
    'src/components/PetColiseum.tsx',
    'src/components/PetDuelLiveHost.tsx',
    'src/components/pet-coliseum/arena-match.tsx',
    'src/components/pet-coliseum/frame-battle.tsx',
]);

function runtimeImports(file) {
    if (importCache.has(file)) return importCache.get(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = [];
    function visit(node) {
        if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const onlyTypes = !clause?.name && bindings && ts.isNamedImports(bindings)
                && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
            if (!onlyTypes) imports.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
            const onlyTypes = node.exportClause && ts.isNamedExports(node.exportClause)
                && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly);
            if (!onlyTypes) imports.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
            imports.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    importCache.set(file, imports);
    return imports;
}

const importCache = new Map();

function resolveEdge(from, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/') && !specifier.startsWith('/src/')) return null;
    const base = specifier.startsWith('@/') ? resolve(client, 'src', specifier.slice(2))
        : specifier.startsWith('/src/') ? resolve(client, specifier.slice(1))
            : resolve(dirname(from), specifier);
    const tsBase = base.replace(/\.js$/, '');
    return [base, ...['.ts', '.tsx', '.js', '.mjs'].map(ext => tsBase + ext),
        ...['.ts', '.tsx', '.js'].map(ext => resolve(base, 'index' + ext))]
        .find(file => /\.(?:tsx?|m?js)$/.test(file) && existsSync(file)) ?? null;
}

test('every game and local preview entry stays disconnected from retired pet battle renderers', context => {
    const entries = readdirSync(client).filter(name => name.endsWith('.html'));
    entries.push(...readdirSync(resolve(client, 'e2e/fixtures'))
        .filter(name => name.endsWith('.html')).map(name => 'e2e/fixtures/' + name));
    assert.ok(entries.includes('index.html') && entries.includes('petvfx.html'));
    let visitedTotal = 0;
    for (const entry of entries) {
        const html = readFileSync(resolve(client, entry), 'utf8');
        const starts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
            .map(match => resolve(match[1].startsWith('/') ? client : dirname(resolve(client, entry)), match[1].replace(/^\//, '')))
            .filter(file => existsSync(file) && /\.(?:tsx?|m?js)$/.test(file));
        const visited = new Set();
        const queue = starts.map(file => ({ file, chain: [entry] }));
        while (queue.length) {
            const { file, chain } = queue.shift();
            if (visited.has(file)) continue;
            visited.add(file);
            const name = relative(client, file).replace(/\\/g, '/');
            assert.ok(!retired.has(name), `Retired renderer is reachable: ${[...chain, name].join(' -> ')}`);
            assert.ok(!readFileSync(file, 'utf8').includes('Choose the Fight Plan'),
                `Retired fight-plan UI is reachable in ${name}`);
            for (const specifier of runtimeImports(file)) {
                const next = resolveEdge(file, specifier);
                if (next) queue.push({ file: next, chain: [...chain, name] });
            }
        }
        visitedTotal += visited.size;
    }
    assert.ok(visitedTotal > 500, 'the guard must traverse the actual application graph');
    context.diagnostic(`Checked ${entries.length} HTML entries and ${importCache.size} runtime modules.`);
});

test('story QA and animation captures cannot request the retired renderer or its preview', () => {
    const story = readFileSync(resolve(client, 'scripts/vn-wiring-qa.mts'), 'utf8');
    assert.doesNotMatch(story, /PetColiseumDuel|components\/PetColiseum|\/api\/pet\/battle-(?:start|result)|pet-result-before-exit/);
    const capture = readFileSync(resolve(client, 'scripts/capture-raijin-animation-pass.mjs'), 'utf8');
    assert.match(capture, /retired/);
    assert.doesNotMatch(capture, /chromium|page\.screenshot|petvfx\.html/);
});
