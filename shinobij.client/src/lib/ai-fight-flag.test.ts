import { test } from "node:test";
import assert from "node:assert/strict";
import { aiFightServerAuthEnabled, setAiFightServerAuthEnabled } from "./ai-fight-flag.ts";

// Minimal in-memory localStorage stub so the flag helpers (which read bare
// `localStorage`) run under node:test. The real module no-ops when storage is
// unavailable; here we give it a store so we can exercise both branches.
class MemStore {
    private m = new Map<string, string>();
    getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string): void { this.m.set(k, String(v)); }
    removeItem(k: string): void { this.m.delete(k); }
    clear(): void { this.m.clear(); }
}

test("aiFightServerAuth: default ON, opt-out only via exactly '0'", () => {
    (globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();
    try {
        // Unset → ON (the server-authoritative default).
        assert.equal(aiFightServerAuthEnabled(), true);

        // Opt out (stored "0", not absent).
        setAiFightServerAuthEnabled(false);
        assert.equal(aiFightServerAuthEnabled(), false);

        // Opt back in.
        setAiFightServerAuthEnabled(true);
        assert.equal(aiFightServerAuthEnabled(), true);

        // Only the literal "0" disables it — any other stored value is ON.
        localStorage.setItem("aiFightServerAuth.v1", "false");
        assert.equal(aiFightServerAuthEnabled(), true);
        localStorage.setItem("aiFightServerAuth.v1", "0");
        assert.equal(aiFightServerAuthEnabled(), false);
    } finally {
        delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    }
});

test("aiFightServerAuth: OFF when storage is unavailable (no localStorage)", () => {
    // No localStorage global at all → the helper swallows the ReferenceError and
    // reports OFF, so a storage-less/SSR context never accidentally enables it.
    delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    assert.equal(aiFightServerAuthEnabled(), false);
});
