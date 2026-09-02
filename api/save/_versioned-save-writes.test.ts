import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/*
 * Reward-integrity guard: EVERY raw server write to a player save
 * (`save:<name>`) must derive the value written by that specific kv.set call
 * from a versioning helper. A file-level helper-name check is not sufficient:
 * one healthy write (or even an unrelated call) could otherwise hide a second
 * raw write and let a stale browser tab clobber currency, XP, or rewards.
 *
 * The AST scan follows local key/value aliases and constant SAVE_PREFIX-style
 * bindings, handles multiline calls, and ignores comments. Shared clan blobs
 * (`save:clan-...`) have their own validators and are outside this guard.
 */

// Resolve api/ from the repo root (npm test always runs from there). import.meta
// is not usable here because API tests are also compiled by the CommonJS build.
const API_DIR = join(process.cwd(), 'api');
const RECORD_VERSIONING_HELPERS = new Set([
    'bumpSaveVersion',
    'versionedPlayerRecord',
]);
const VERSION_PRESERVING_WRAPPERS = new Set(['mergePreservingImages']);
/*
 * Writes that must NOT publish a version, stated deliberately rather than
 * omitted. Exactly one exists: the vitals-regen projection in
 * `_elapsed-state.ts`, which persists only values a later read re-derives from
 * `_saveAt`. Bumping for it declared the owner's open client stale and 409'd its
 * own next autosave. The second test below pins this to that single call site,
 * so accepting the name here cannot turn into a general way past this guard.
 */
const VERSIONLESS_BY_DESIGN = new Set(['unversionedSettledRecord']);
const VERSIONLESS_BY_DESIGN_CALLERS: ReadonlyArray<readonly [string, number]> = [['_elapsed-state.ts', 1]];

type Binding = { initializer?: ts.Expression };
type Scope = Map<string, Binding>;
type PlayerSaveWrite = { line: number; versioned: boolean };
type StaticPrefix = { text: string; complete: boolean };

function collectTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) collectTsFiles(p, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(p);
    }
    return out;
}

function lookupBinding(scopes: Scope[], name: string): Binding | undefined {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const binding = scopes[i].get(name);
        if (binding) return binding;
    }
    return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isAwaitExpression(current)
        || ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isNonNullExpression(current)
        || ts.isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
}

function staticPrefix(
    expression: ts.Expression,
    scopes: Scope[],
    seen: Set<Binding> = new Set(),
): StaticPrefix {
    const value = unwrapExpression(expression);
    if (ts.isStringLiteralLike(value)) return { text: value.text, complete: true };
    if (ts.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding)) return { text: '', complete: false };
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return staticPrefix(binding.initializer, scopes, nextSeen);
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticPrefix(value.left, scopes, seen);
        if (!left.complete) return left;
        const right = staticPrefix(value.right, scopes, seen);
        return { text: left.text + right.text, complete: right.complete };
    }
    if (ts.isTemplateExpression(value)) {
        let text = value.head.text;
        for (const span of value.templateSpans) {
            const dynamic = staticPrefix(span.expression, scopes, seen);
            text += dynamic.text;
            if (!dynamic.complete) return { text, complete: false };
            text += span.literal.text;
        }
        return { text, complete: true };
    }
    return { text: '', complete: false };
}

function isPlayerSaveKey(expression: ts.Expression, scopes: Scope[]): boolean {
    const prefix = staticPrefix(expression, scopes);
    if (!prefix.complete) return prefix.text === 'save:';
    if (!prefix.text.startsWith('save:')) return false;
    const suffix = prefix.text.slice('save:'.length);
    return Boolean(suffix) && !suffix.startsWith('clan-') && !suffix.startsWith('admin');
}

function callName(expression: ts.LeftHandSideExpression): string | null {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

function derivesFromNextSaveVersion(
    expression: ts.Expression,
    scopes: Scope[],
    seen: Set<Binding> = new Set(),
): boolean {
    const value = unwrapExpression(expression);
    if (ts.isCallExpression(value) && callName(value.expression) === 'nextSaveVersion') return true;
    if (ts.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding)) return false;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return derivesFromNextSaveVersion(binding.initializer, scopes, nextSeen);
    }
    return false;
}

function propertyName(node: ts.PropertyName): string | null {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    return null;
}

function playerBranchForClanDiscriminator(
    expression: ts.Expression,
    scopes: Scope[],
    seen: Set<Binding> = new Set(),
): 'true' | 'false' | null {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding)) return null;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return playerBranchForClanDiscriminator(binding.initializer, scopes, nextSeen);
    }
    if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
        const branch = playerBranchForClanDiscriminator(value.operand, scopes, seen);
        return branch === 'true' ? 'false' : branch === 'false' ? 'true' : null;
    }
    if (ts.isCallExpression(value)
        && ts.isPropertyAccessExpression(value.expression)
        && value.expression.name.text === 'startsWith'
        && value.arguments.length === 1
        && ts.isStringLiteralLike(value.arguments[0])
        && value.arguments[0].text === 'clan-') {
        // `name.startsWith('clan-')` is true only for the shared clan namespace,
        // so a player-save write can reach only the false branch.
        return 'false';
    }
    return null;
}

function derivesFromVersioningHelper(
    expression: ts.Expression,
    scopes: Scope[],
    seen: Set<Binding> = new Set(),
): boolean {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding || seen.has(binding)) return false;
        if (!binding.initializer) return false;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return derivesFromVersioningHelper(binding.initializer, scopes, nextSeen);
    }
    if (ts.isCallExpression(value)) {
        const name = callName(value.expression) ?? '';
        if (RECORD_VERSIONING_HELPERS.has(name) || VERSIONLESS_BY_DESIGN.has(name)) return true;
        if (VERSION_PRESERVING_WRAPPERS.has(name) && value.arguments.length > 0) {
            // mergePreservingImages writes incoming over existing. The incoming
            // record itself must be bumped; merely passing an old versioned
            // record as a later/decoy argument is not sufficient.
            return derivesFromVersioningHelper(value.arguments[0], scopes, seen);
        }
        return false;
    }
    if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
            if (ts.isSpreadAssignment(property)
                && derivesFromVersioningHelper(property.expression, scopes, seen)) return true;
            if (ts.isPropertyAssignment(property)
                && propertyName(property.name) === '_saveVersion'
                && derivesFromNextSaveVersion(property.initializer, scopes)) return true;
        }
        return false;
    }
    if (ts.isConditionalExpression(value)) {
        const playerBranch = playerBranchForClanDiscriminator(value.condition, scopes);
        if (playerBranch === 'true') return derivesFromVersioningHelper(value.whenTrue, scopes, seen);
        if (playerBranch === 'false') return derivesFromVersioningHelper(value.whenFalse, scopes, seen);
        return derivesFromVersioningHelper(value.whenTrue, scopes, seen)
            && derivesFromVersioningHelper(value.whenFalse, scopes, seen);
    }

    return false;
}

function isKvSetCall(node: ts.Node): node is ts.CallExpression {
    return ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'kv'
        && node.expression.name.text === 'set';
}

function scanPlayerSaveWrites(source: string, fileName = 'fixture.ts'): PlayerSaveWrite[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const scopes: Scope[] = [new Map()];
    const writes: PlayerSaveWrite[] = [];

    const visit = (node: ts.Node): void => {
        let pushedScope = false;
        if (ts.isFunctionLike(node)) {
            scopes.push(new Map());
            pushedScope = true;
            for (const parameter of node.parameters) {
                if (ts.isIdentifier(parameter.name)) {
                    scopes[scopes.length - 1].set(parameter.name.text, { initializer: parameter.initializer });
                }
            }
        } else if (ts.isBlock(node)) {
            scopes.push(new Map());
            pushedScope = true;
        }

        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            scopes[scopes.length - 1].set(node.name.text, { initializer: node.initializer });
        } else if (ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(node.left)) {
            const binding = lookupBinding(scopes, node.left.text);
            if (binding) binding.initializer = node.right;
        }

        if (isKvSetCall(node) && node.arguments.length >= 2 && isPlayerSaveKey(node.arguments[0], scopes)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            writes.push({
                line: line + 1,
                versioned: derivesFromVersioningHelper(node.arguments[1], scopes),
            });
        }

        ts.forEachChild(node, visit);
        if (pushedScope) scopes.pop();
    };

    visit(sourceFile);
    return writes;
}

test('every raw player-save kv.set derives that exact value from a versioned helper', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(API_DIR)) {
        const rel = relative(API_DIR, file).replace(/\\/g, '/');
        for (const write of scanPlayerSaveWrites(readFileSync(file, 'utf8'), file)) {
            if (!write.versioned) offenders.push(`${rel}:${write.line}`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `These raw player-save writes do not derive their value from a versioning helper. ` +
        `Route the mutation through writeVersionedPlayerSave/mutatePlayerSave or write a ` +
        `record produced by bumpSaveVersion/nextSaveVersion:\n  ${offenders.join('\n  ')}`,
    );
});

test('the versionless-by-design escape hatch stays at its one intended call site', () => {
    // Accepting `unversionedSettledRecord` above is what lets a projection-only
    // settle write without publishing a version. That is correct for regen and
    // WRONG for anything that credits ryo, XP, items or progress — a stale tab
    // would clobber it. So the hatch is counted, not merely allowed: a new caller
    // has to change this list and justify itself in review.
    const callers: Array<readonly [string, number]> = [];
    for (const file of collectTsFiles(API_DIR)) {
        const rel = relative(API_DIR, file).replace(/\\/g, '/');
        if (rel === 'save/_save-version.ts') continue; // the declaration itself
        const source = readFileSync(file, 'utf8');
        let uses = 0;
        for (const helper of VERSIONLESS_BY_DESIGN) {
            uses += (source.match(new RegExp(`\\b${helper}\\s*\\(`, 'g')) ?? []).length;
        }
        if (uses > 0) callers.push([rel, uses]);
    }
    assert.deepEqual(
        callers.map(([file, uses]) => `${file}:${uses}`),
        VERSIONLESS_BY_DESIGN_CALLERS.map(([file, uses]) => `${file}:${uses}`),
        'A versionless player-save write appeared outside the settle projection. ' +
        'If it credits anything a player keeps, it must use bumpSaveVersion instead.',
    );
});

test('the AST guard sees a healthy number of real player-save writes', () => {
    const writes = collectTsFiles(API_DIR).reduce(
        (count, file) => count + scanPlayerSaveWrites(readFileSync(file, 'utf8'), file).length,
        0,
    );
    assert.ok(writes >= 10, `expected at least 10 raw player-save writers, found ${writes}`);
});

test('the AST guard catches multiline, aliases, SAVE_PREFIX, comments, decoys, and mixed writes', () => {
    const fixture = `
        const SAVE_PREFIX = 'save:';
        const goodKey = \`${'${SAVE_PREFIX}'}${'${name}'}\`;
        const good = bumpSaveVersion(rawRecord);
        await kv.set(\`save:${'${other}'}\`, mergePreservingImages(good, previous));

        const mutatedKey = \`save:${'${mutatedName}'}\`;
        const mutated = { ...rawRecord, character: nextCharacter };
        await kv.set(mutatedKey, mergePreservingImages(bumpSaveVersion(mutated), previous));

        // bumpSaveVersion(commentOnly)
        bumpSaveVersion(unrelated);
        const badKey = SAVE_PREFIX + name;
        await kv.set(
            badKey,
            rawRecord,
        );

        await kv.set(\`save:${'${decoyName}'}\`, {
            ...rawRecord,
            decoy: bumpSaveVersion(unrelated),
        });

        const isClanSave = name.startsWith('clan-');
        const multiplexed = isClanSave
            ? rawClan
            : { ...rawRecord, _saveVersion: nextSaveVersion(rawRecord._saveVersion) };
        await kv.set(\`save:${'${name}'}\`, multiplexed);

        const conditionalRaw = { ...rawRecord };
        if (false) bumpSaveVersion(conditionalRaw);
        await kv.set(\`save:${'${conditionalName}'}\`, conditionalRaw);

        const nestedRaw = { ...rawRecord };
        function neverCalled() { bumpSaveVersion(nestedRaw); }
        await kv.set(\`save:${'${nestedName}'}\`, nestedRaw);

        const clanKey = \`save:clan-${'${name}'}\`;
        await kv.set(clanKey, rawClan);
    `;
    assert.deepEqual(
        scanPlayerSaveWrites(fixture).map((write) => write.versioned),
        [true, true, false, false, true, false, false],
    );
});
