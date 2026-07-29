import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { gameToast, readingTime } from "./GameToast";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── the safety contract of the imperative API ─────────────────────────────
// A toast is cosmetic. Firing one must never be able to break the game action
// that triggered it, including when no host is mounted (tests, early boot).

test("gameToast never throws without a mounted host", () => {
    assert.doesNotThrow(() => gameToast("Crafted 3x Kunai."));
});

test("gameToast ignores blank messages", () => {
    // An empty toast would render as a stray clickable bar.
    assert.doesNotThrow(() => gameToast(""));
    assert.doesNotThrow(() => gameToast("   "));
    assert.doesNotThrow(() => gameToast(undefined as unknown as string));
});

test("gameToast tolerates a flood without unbounded growth", () => {
    // Pre-mount buffering is capped, so a reward loop can't queue hundreds.
    assert.doesNotThrow(() => { for (let i = 0; i < 500; i++) gameToast(`msg ${i}`); });
});

test("readingTime gives longer messages more time on screen, within bounds", () => {
    const short = readingTime("Crafted 3x Kunai.");
    const long = readingTime(
        "Sent 5,000 ryo to Rill. They received 4,750 (250 burned as tax).",
    );
    assert.equal(short, 3000, "a short confirmation sits at the base duration");
    assert.ok(long > short, "a detailed receipt must stay up longer than a one-liner");
    assert.ok(long <= 8000, "but never longer than the 8s ceiling");
    // A pathological message must not pin a toast on screen indefinitely.
    assert.equal(readingTime("x".repeat(5000)), 8000);
});

// ── the rule that matters for players ─────────────────────────────────────
// Toasts auto-dismiss, so a message the player must act on cannot be one.
// alert() stays the channel for failures and refusals. This scans call sites so
// a future "just make it a toast" edit on an error is caught here.

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "dist") sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const FAILURE_WORDS =
    /\b(?:failed|failure|error|cannot|can't|couldn't|could not|unable|denied|invalid|not enough|too (?:low|few|many|weak)|required|unavailable|expired|banned)\b/i;

test("no gameToast() carries a failure message", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
        const text = readFileSync(file, "utf8");
        // Match the first argument up to the end of its string literal.
        for (const m of text.matchAll(/\bgameToast\(\s*([`"'])((?:[^\\]|\\.)*?)\1/g)) {
            const message = m[2];
            if (FAILURE_WORDS.test(message)) {
                offenders.push(`${relative(SRC, file).replace(/\\/g, "/")}: ${message.slice(0, 60)}`);
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        "A toast auto-dismisses, so a failure the player needs to see must stay an alert() " +
            `(or a gameConfirm). Offending call site(s):\n  ${offenders.join("\n  ")}`,
    );
});

test("the demoted call sites are actually using gameToast", () => {
    // Spot-check one per migrated screen so a bad merge that reverts them is caught.
    const expectations: Array<[string, RegExp]> = [
        ["screens/Bank.tsx", /gameToast\(`Sent \$\{/],
        ["screens/CentralHub.tsx", /gameToast\(`Crafted \$\{/],
        ["screens/ClanHall.tsx", /gameToast\(`Collected \$\{/],
        ["screens/Hospital.tsx", /gameToast\(`\u{1F4B0} You paid \$\{/u],
        ["screens/PetYard.tsx", /gameToast\(`Collected \$\{/],
    ];
    for (const [file, rx] of expectations) {
        const text = readFileSync(join(SRC, file), "utf8");
        assert.match(text, rx, `${file} should show its routine confirmation as a toast`);
    }
});
