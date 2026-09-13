import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/*
 * A dynamic import() that nobody awaits must handle its own rejection.
 *
 * Chunk loads fail in production: a deploy rotates chunk hashes under an open
 * tab, or a mobile network drops the request. When the import() is
 * fire-and-forget (`void import(...)`, or a bare `import(...)` statement), the
 * rejection escapes unhandled. Playwright records that as a pageerror, which
 * fails every e2e spec that asserts none occurred, so it showed up as flakes in
 * unrelated specs whenever the machine was loaded. Retrying in place does not
 * help, because Chromium, Firefox and WebKit all keep a failed module fetch for
 * the life of the page. So each call site decides what a failed load means (a
 * warm-up swallows it; a real load falls back to something) and says so with a
 * rejection handler.
 *
 * This scans every .ts/.tsx file under src/. For each fire-and-forget statement
 * whose promise chain starts at import(), it follows the rejection outward
 * through `.then(onFulfilled)` and `.finally()` links, and requires it to reach
 * a `.catch()` or a two-argument `.then()`. It cannot see an import() that is
 * wrapped in a helper or returned from a function. Those hand the rejection to
 * their caller, which is where it has to be handled.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Files allowed to leave some fire-and-forget imports unhandled, with the exact
 * count. An exact count means a new unhandled import in these files still fails
 * this test, and so does fixing one without lowering the number.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
    "components/OfflineNoticeDigestHost.tsx": {
        count: 1,
        why: "imports react-dom/client, which main.tsx imports statically; by the time the digest mounts, the entry has evaluated it, so the import resolves from the module map and requests nothing (checked against the 2026-09-13 build)",
    },
    "petvfx.tsx": {
        count: 3,
        why: "standalone dev-only VFX harness (petvfx.html), not in the player bundle; the import IS the page, so a failed load has nothing to fall back to",
    },
};

/** Unhandled fire-and-forget imports in one source text, as 1-based line numbers and snippets. */
function unhandledFireAndForgetImports(fileName: string, text: string): Array<{ line: number; code: string }> {
    const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const found: Array<{ line: number; code: string }> = [];

    const unwrap = (node: ts.Expression): ts.Expression => {
        let current = node;
        while (ts.isParenthesizedExpression(current)) current = current.expression;
        return current;
    };

    /** True when `node` is import() itself or a .then/.catch/.finally chain rooted at one. */
    const rootedAtImport = (node: ts.Expression): boolean => {
        const current = unwrap(node);
        if (!ts.isCallExpression(current)) return false;
        if (current.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
        const callee = current.expression;
        return ts.isPropertyAccessExpression(callee)
            && ["then", "catch", "finally"].includes(callee.name.text)
            && rootedAtImport(callee.expression);
    };

    /** True when some link between the import() and `node` receives the rejection. */
    const handlesRejection = (node: ts.Expression): boolean => {
        const current = unwrap(node);
        if (!ts.isCallExpression(current) || current.expression.kind === ts.SyntaxKind.ImportKeyword) return false;
        const callee = current.expression as ts.PropertyAccessExpression;
        const method = callee.name.text;
        if (method === "catch" && current.arguments.length >= 1) return true;
        if (method === "then" && current.arguments.length >= 2) return true;
        return handlesRejection(callee.expression);
    };

    const check = (expression: ts.Expression) => {
        if (!rootedAtImport(expression) || handlesRejection(expression)) return;
        const { line } = source.getLineAndCharacterOfPosition(expression.getStart(source));
        found.push({ line: line + 1, code: expression.getText(source).replace(/\s+/g, " ").slice(0, 120) });
    };

    const visit = (node: ts.Node) => {
        if (ts.isVoidExpression(node)) check(node.expression);
        else if (ts.isExpressionStatement(node)) check(node.expression);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        if (!/\.tsx?$/.test(entry.name) || /\.d\.ts$|\.test\.tsx?$/.test(entry.name)) return [];
        return [path];
    });
}

test("the checker flags an unhandled fire-and-forget import and accepts every handled shape", () => {
    // Shapes taken from the call sites this test was written for (2026-09-13).
    const flagged = [
        `void import("../screens/MissionArenaFight");`,
        `void import("./lib/offline-notices").then((m) => m.applyOfflineNotices(notices));`,
        `void (import("./x")).then(f).finally(g);`,
        `import("./x").then(f);`,
        `function f() { if (wide) void import('./styles/mobile-noncombat-aaa.css') }`,
        // .catch() with no argument registers no handler; the rejection passes through.
        `void import("./x").catch();`,
    ];
    for (const code of flagged) assert.equal(unhandledFireAndForgetImports("probe.tsx", code).length, 1, code);

    const handled = [
        `void import("../screens/MissionArenaFight").catch(() => {});`,
        `void import("./x").then((m) => m.run(), () => fallback());`,
        `void import("./x").then(f).catch(g);`,
        `void import("./x").catch(g).then(f);`,
        `void import("./x").then(f).catch(g).finally(h);`,
        // Not fire-and-forget: the rejection goes to whoever holds the promise.
        `const pending = import("./x");`,
        `async function f() { await import("./x"); }`,
        `const load = () => import("./x");`,
        `void loadIntroCinematic();`,
        `void Promise.race([import("./x").then(f).catch(g), timeout]);`,
    ];
    for (const code of handled) assert.deepEqual(unhandledFireAndForgetImports("probe.tsx", code), [], code);
});

test("every fire-and-forget dynamic import in src/ handles its own rejection", async () => {
    const counts = new Map<string, Array<{ line: number; code: string }>>();
    // Read in parallel: on Windows, a thousand sequential reads took 9-12 s
    // (2026-09-13), against about a second in parallel.
    const paths = sourceFiles(SRC);
    const texts = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    paths.forEach((path, index) => {
        const text = texts[index];
        if (!/\bimport\s*\(/.test(text)) return;
        const found = unhandledFireAndForgetImports(path, text);
        if (found.length) counts.set(relative(SRC, path).split("\\").join("/"), found);
    });

    const violations: string[] = [];
    for (const [file, found] of counts) {
        const allowed = ALLOWED[file];
        if (allowed && allowed.count === found.length) continue;
        const lines = found.map(({ line, code }) => `  src/${file}:${line}  ${code}`).join("\n");
        violations.push(allowed
            ? `src/${file} has ${found.length} unhandled fire-and-forget imports; ALLOWED pins exactly ${allowed.count}:\n${lines}`
            : `src/${file}:\n${lines}`);
    }
    for (const [file, allowed] of Object.entries(ALLOWED)) {
        if (!counts.has(file)) violations.push(`src/${file} no longer has the ${allowed.count} unhandled imports ALLOWED pins; remove its entry`);
    }

    assert.deepEqual(violations, [], [
        "A fire-and-forget import() must end in a rejection handler, or a failed chunk load escapes unhandled",
        "(a pageerror in every e2e spec that asserts none). Decide what a failed load should do there: a warm-up",
        "swallows it with .catch(() => {}); a real load shows a fallback or keeps what it would have consumed.",
        "Do not rely on retrying the import: browsers keep a failed module fetch for the life of the page.",
        "",
        ...violations,
    ].join("\n"));
});
