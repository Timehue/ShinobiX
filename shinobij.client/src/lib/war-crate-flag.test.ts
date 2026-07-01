import { test } from "node:test";
import assert from "node:assert/strict";
import { warCrateServerAuthEnabled, setWarCrateServerAuthEnabled } from "./war-crate-flag.ts";

class MemStore {
    private m = new Map<string, string>();
    getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string): void { this.m.set(k, String(v)); }
    removeItem(k: string): void { this.m.delete(k); }
    clear(): void { this.m.clear(); }
}

test("warCrateServerAuth: default OFF, opt-in only via exactly '1'", () => {
    (globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();
    try {
        assert.equal(warCrateServerAuthEnabled(), false);          // unset → OFF (byte-identical default)
        setWarCrateServerAuthEnabled(true);
        assert.equal(warCrateServerAuthEnabled(), true);
        setWarCrateServerAuthEnabled(false);
        assert.equal(warCrateServerAuthEnabled(), false);
        localStorage.setItem("warCrateServerAuth.v1", "true");
        assert.equal(warCrateServerAuthEnabled(), false);          // only literal "1" enables
    } finally {
        delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    }
});

test("warCrateServerAuth: OFF when storage is unavailable", () => {
    delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    assert.equal(warCrateServerAuthEnabled(), false);
});
