/*
 * Every entry into a Showdown must warm its models first.
 *
 * PetShowdownBattle renders each fighter's GLB inside `<Suspense fallback=
 * {null}>`. That is the right choice for a warmed model and a trap for a cold
 * one: an unresolved model does not draw a placeholder or the 2D standee, it
 * draws NOTHING. So a caller that mounts the battle without warming puts the
 * player in an arena where the opponent is invisible for its first seconds —
 * and the opponent is exactly the half that is never warm, because it is
 * chosen by the server and only named by the response that starts the fight.
 *
 * This is a SOURCE-SHAPE guard for the same reason api/pet/_showdown-rewards
 * .test.ts is one: the failure is invisible in review (the code looks complete;
 * only the first-frame timing is wrong), it is a one-line omission, and there
 * are now five call sites. A behavioural test cannot see it without standing up
 * WebGL and a network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

// fileURLToPath, not `.pathname` — this repo lives under a path with a space
// in it, which `.pathname` hands back percent-encoded.
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Only the renderer itself. The dev harness is deliberately NOT exempt: it
 *  fields real pets with real templateIds, so it resolves real GLBs and shows
 *  the same empty arena — in the tool used to review the battle's visuals. */
const EXEMPT = new Set(["PetShowdownBattle.tsx"]);

/** `import type …` and `export type … from` statements. TypeScript always erases
 *  them, so borrowing a type from the battle loads and mounts nothing. Inline
 *  `{ type X }` specifiers are left in and still count, which errs on the safe
 *  side. */

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
        return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
}

function isShowdownModule(specifier: ts.Expression): boolean {
    if (!ts.isStringLiteralLike(specifier)) return false;
    const fileName = specifier.text.split(/[\\/]/).pop() ?? "";
    return fileName.replace(/\.[cm]?[jt]sx?$/i, "") === "PetShowdownBattle";
}

function importsShowdownAtRuntime(source: string, fileName = "entry.tsx"): boolean {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let importsShowdown = false;

    const visit = (node: ts.Node): void => {
        if (importsShowdown) return;

        if (ts.isImportDeclaration(node) && isShowdownModule(node.moduleSpecifier)) {
            const clause = node.importClause;
            if (!clause) {
                importsShowdown = true;
            } else if (!clause.isTypeOnly) {
                importsShowdown = Boolean(
                    clause.name
                    || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
                    || (clause.namedBindings
                        && ts.isNamedImports(clause.namedBindings)
                        && clause.namedBindings.elements.some((element) => !element.isTypeOnly)),
                );
            }
        } else if (
            ts.isCallExpression(node)
            && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.some(isShowdownModule)
        ) {
            // Literal dynamic imports are the supported lazy-loading form used
            // by the client. TypeScript import types are not CallExpressions.
            importsShowdown = true;
        }

        if (!importsShowdown) ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return importsShowdown;
}

function findColdEntries(modules: Array<{ file: string; src: string }>): string[] {
    return modules
        .filter(({ file }) => !EXEMPT.has(file.split(/[\\/]/).pop() ?? ""))
        .filter(({ src, file }) => importsShowdownAtRuntime(src, file))
        .filter(({ src }) => !src.includes("warmShowdownModels"))
        .map(({ file }) => file.split(/[\\/]/).pop() ?? file);
}

test("type-only imports and import types are not renderer entry points", () => {
    assert.equal(importsShowdownAtRuntime('import type { SceneBeat } from "../PetShowdownBattle";'), false);
    assert.equal(importsShowdownAtRuntime('type SceneBeat = import("../PetShowdownBattle").SceneBeat;'), false);
});

test("mixed value imports and literal dynamic imports are renderer entry points", () => {
    assert.equal(importsShowdownAtRuntime('import { type SceneBeat, PetShowdownBattle } from "../PetShowdownBattle";'), true);
    assert.equal(importsShowdownAtRuntime('const Battle = import("../PetShowdownBattle");'), true);
});

test("the guard catches an unprotected runtime entry", () => {
    assert.deepEqual(findColdEntries([{
        file: "ColdEntry.tsx",
        src: 'import { PetShowdownBattle } from "../PetShowdownBattle"; export const view = <PetShowdownBattle />;',
    }]), ["ColdEntry.tsx"]);
});

test("every module that mounts PetShowdownBattle warms its models first", () => {
    const mounters = walk(SRC)
        .map((file) => ({ file, src: readFileSync(file, "utf8") }))
        .filter(({ src, file }) => importsShowdownAtRuntime(src, file))
        .filter(({ file }) => !EXEMPT.has(file.split(/[\\/]/).pop() ?? ""));

    assert.ok(mounters.length >= 4, `expected the known Showdown entries, found ${mounters.length}`);

    const cold = findColdEntries(mounters);
    assert.deepEqual(cold, [], `these mount a Showdown without warming its models: ${cold.join(", ")}`);
});
