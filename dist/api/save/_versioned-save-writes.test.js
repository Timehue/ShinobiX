"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const typescript_1 = __importDefault(require("typescript"));
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
const API_DIR = (0, node_path_1.join)(process.cwd(), 'api');
const RECORD_VERSIONING_HELPERS = new Set([
    'bumpSaveVersion',
    'versionedPlayerRecord',
]);
const VERSION_PRESERVING_WRAPPERS = new Set(['mergePreservingImages']);
function collectTsFiles(dir, out = []) {
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const p = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory())
            collectTsFiles(p, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
            out.push(p);
    }
    return out;
}
function lookupBinding(scopes, name) {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const binding = scopes[i].get(name);
        if (binding)
            return binding;
    }
    return undefined;
}
function unwrapExpression(expression) {
    let current = expression;
    while (typescript_1.default.isAwaitExpression(current)
        || typescript_1.default.isParenthesizedExpression(current)
        || typescript_1.default.isAsExpression(current)
        || typescript_1.default.isTypeAssertionExpression(current)
        || typescript_1.default.isNonNullExpression(current)
        || typescript_1.default.isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
}
function staticPrefix(expression, scopes, seen = new Set()) {
    const value = unwrapExpression(expression);
    if (typescript_1.default.isStringLiteralLike(value))
        return { text: value.text, complete: true };
    if (typescript_1.default.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding))
            return { text: '', complete: false };
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return staticPrefix(binding.initializer, scopes, nextSeen);
    }
    if (typescript_1.default.isBinaryExpression(value) && value.operatorToken.kind === typescript_1.default.SyntaxKind.PlusToken) {
        const left = staticPrefix(value.left, scopes, seen);
        if (!left.complete)
            return left;
        const right = staticPrefix(value.right, scopes, seen);
        return { text: left.text + right.text, complete: right.complete };
    }
    if (typescript_1.default.isTemplateExpression(value)) {
        let text = value.head.text;
        for (const span of value.templateSpans) {
            const dynamic = staticPrefix(span.expression, scopes, seen);
            text += dynamic.text;
            if (!dynamic.complete)
                return { text, complete: false };
            text += span.literal.text;
        }
        return { text, complete: true };
    }
    return { text: '', complete: false };
}
function isPlayerSaveKey(expression, scopes) {
    const prefix = staticPrefix(expression, scopes);
    if (!prefix.complete)
        return prefix.text === 'save:';
    if (!prefix.text.startsWith('save:'))
        return false;
    const suffix = prefix.text.slice('save:'.length);
    return Boolean(suffix) && !suffix.startsWith('clan-') && !suffix.startsWith('admin');
}
function callName(expression) {
    if (typescript_1.default.isIdentifier(expression))
        return expression.text;
    if (typescript_1.default.isPropertyAccessExpression(expression))
        return expression.name.text;
    return null;
}
function derivesFromNextSaveVersion(expression, scopes, seen = new Set()) {
    const value = unwrapExpression(expression);
    if (typescript_1.default.isCallExpression(value) && callName(value.expression) === 'nextSaveVersion')
        return true;
    if (typescript_1.default.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding))
            return false;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return derivesFromNextSaveVersion(binding.initializer, scopes, nextSeen);
    }
    return false;
}
function propertyName(node) {
    if (typescript_1.default.isIdentifier(node) || typescript_1.default.isStringLiteralLike(node))
        return node.text;
    return null;
}
function playerBranchForClanDiscriminator(expression, scopes, seen = new Set()) {
    const value = unwrapExpression(expression);
    if (typescript_1.default.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding?.initializer || seen.has(binding))
            return null;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return playerBranchForClanDiscriminator(binding.initializer, scopes, nextSeen);
    }
    if (typescript_1.default.isPrefixUnaryExpression(value) && value.operator === typescript_1.default.SyntaxKind.ExclamationToken) {
        const branch = playerBranchForClanDiscriminator(value.operand, scopes, seen);
        return branch === 'true' ? 'false' : branch === 'false' ? 'true' : null;
    }
    if (typescript_1.default.isCallExpression(value)
        && typescript_1.default.isPropertyAccessExpression(value.expression)
        && value.expression.name.text === 'startsWith'
        && value.arguments.length === 1
        && typescript_1.default.isStringLiteralLike(value.arguments[0])
        && value.arguments[0].text === 'clan-') {
        // `name.startsWith('clan-')` is true only for the shared clan namespace,
        // so a player-save write can reach only the false branch.
        return 'false';
    }
    return null;
}
function derivesFromVersioningHelper(expression, scopes, seen = new Set()) {
    const value = unwrapExpression(expression);
    if (typescript_1.default.isIdentifier(value)) {
        const binding = lookupBinding(scopes, value.text);
        if (!binding || seen.has(binding))
            return false;
        if (!binding.initializer)
            return false;
        const nextSeen = new Set(seen);
        nextSeen.add(binding);
        return derivesFromVersioningHelper(binding.initializer, scopes, nextSeen);
    }
    if (typescript_1.default.isCallExpression(value)) {
        const name = callName(value.expression) ?? '';
        if (RECORD_VERSIONING_HELPERS.has(name))
            return true;
        if (VERSION_PRESERVING_WRAPPERS.has(name) && value.arguments.length > 0) {
            // mergePreservingImages writes incoming over existing. The incoming
            // record itself must be bumped; merely passing an old versioned
            // record as a later/decoy argument is not sufficient.
            return derivesFromVersioningHelper(value.arguments[0], scopes, seen);
        }
        return false;
    }
    if (typescript_1.default.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
            if (typescript_1.default.isSpreadAssignment(property)
                && derivesFromVersioningHelper(property.expression, scopes, seen))
                return true;
            if (typescript_1.default.isPropertyAssignment(property)
                && propertyName(property.name) === '_saveVersion'
                && derivesFromNextSaveVersion(property.initializer, scopes))
                return true;
        }
        return false;
    }
    if (typescript_1.default.isConditionalExpression(value)) {
        const playerBranch = playerBranchForClanDiscriminator(value.condition, scopes);
        if (playerBranch === 'true')
            return derivesFromVersioningHelper(value.whenTrue, scopes, seen);
        if (playerBranch === 'false')
            return derivesFromVersioningHelper(value.whenFalse, scopes, seen);
        return derivesFromVersioningHelper(value.whenTrue, scopes, seen)
            && derivesFromVersioningHelper(value.whenFalse, scopes, seen);
    }
    return false;
}
function isKvSetCall(node) {
    return typescript_1.default.isCallExpression(node)
        && typescript_1.default.isPropertyAccessExpression(node.expression)
        && typescript_1.default.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'kv'
        && node.expression.name.text === 'set';
}
function scanPlayerSaveWrites(source, fileName = 'fixture.ts') {
    const sourceFile = typescript_1.default.createSourceFile(fileName, source, typescript_1.default.ScriptTarget.Latest, true, typescript_1.default.ScriptKind.TS);
    const scopes = [new Map()];
    const writes = [];
    const visit = (node) => {
        let pushedScope = false;
        if (typescript_1.default.isFunctionLike(node)) {
            scopes.push(new Map());
            pushedScope = true;
            for (const parameter of node.parameters) {
                if (typescript_1.default.isIdentifier(parameter.name)) {
                    scopes[scopes.length - 1].set(parameter.name.text, { initializer: parameter.initializer });
                }
            }
        }
        else if (typescript_1.default.isBlock(node)) {
            scopes.push(new Map());
            pushedScope = true;
        }
        if (typescript_1.default.isVariableDeclaration(node) && typescript_1.default.isIdentifier(node.name)) {
            scopes[scopes.length - 1].set(node.name.text, { initializer: node.initializer });
        }
        else if (typescript_1.default.isBinaryExpression(node)
            && node.operatorToken.kind === typescript_1.default.SyntaxKind.EqualsToken
            && typescript_1.default.isIdentifier(node.left)) {
            const binding = lookupBinding(scopes, node.left.text);
            if (binding)
                binding.initializer = node.right;
        }
        if (isKvSetCall(node) && node.arguments.length >= 2 && isPlayerSaveKey(node.arguments[0], scopes)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            writes.push({
                line: line + 1,
                versioned: derivesFromVersioningHelper(node.arguments[1], scopes),
            });
        }
        typescript_1.default.forEachChild(node, visit);
        if (pushedScope)
            scopes.pop();
    };
    visit(sourceFile);
    return writes;
}
(0, node_test_1.test)('every raw player-save kv.set derives that exact value from a versioned helper', () => {
    const offenders = [];
    for (const file of collectTsFiles(API_DIR)) {
        const rel = (0, node_path_1.relative)(API_DIR, file).replace(/\\/g, '/');
        for (const write of scanPlayerSaveWrites((0, node_fs_1.readFileSync)(file, 'utf8'), file)) {
            if (!write.versioned)
                offenders.push(`${rel}:${write.line}`);
        }
    }
    strict_1.default.deepEqual(offenders, [], `These raw player-save writes do not derive their value from a versioning helper. ` +
        `Route the mutation through writeVersionedPlayerSave/mutatePlayerSave or write a ` +
        `record produced by bumpSaveVersion/nextSaveVersion:\n  ${offenders.join('\n  ')}`);
});
(0, node_test_1.test)('the AST guard sees a healthy number of real player-save writes', () => {
    const writes = collectTsFiles(API_DIR).reduce((count, file) => count + scanPlayerSaveWrites((0, node_fs_1.readFileSync)(file, 'utf8'), file).length, 0);
    strict_1.default.ok(writes >= 10, `expected at least 10 raw player-save writers, found ${writes}`);
});
(0, node_test_1.test)('the AST guard catches multiline, aliases, SAVE_PREFIX, comments, decoys, and mixed writes', () => {
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
    strict_1.default.deepEqual(scanPlayerSaveWrites(fixture).map((write) => write.versioned), [true, true, false, false, true, false, false]);
});
