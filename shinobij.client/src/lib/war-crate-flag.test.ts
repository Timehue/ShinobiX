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

test("warCrateServerAuth: mandatory even when legacy storage requests opt-out", () => {
    (globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();
    try {
        assert.equal(warCrateServerAuthEnabled(), true);
        setWarCrateServerAuthEnabled(false);
        assert.equal(warCrateServerAuthEnabled(), true);
        setWarCrateServerAuthEnabled(true);
        assert.equal(warCrateServerAuthEnabled(), true);
        localStorage.setItem("warCrateServerAuth.v1", "false");
        assert.equal(warCrateServerAuthEnabled(), true);
    } finally {
        delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    }
});

test("warCrateServerAuth: remains mandatory when storage is unavailable", () => {
    delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    assert.equal(warCrateServerAuthEnabled(), true);
});
