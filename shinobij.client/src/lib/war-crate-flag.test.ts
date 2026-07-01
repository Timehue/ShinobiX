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

test("warCrateServerAuth: default ON, opt-out only via exactly '0'", () => {
    (globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();
    try {
        assert.equal(warCrateServerAuthEnabled(), true);           // unset → ON (server-authoritative default)
        setWarCrateServerAuthEnabled(false);
        assert.equal(warCrateServerAuthEnabled(), false);
        setWarCrateServerAuthEnabled(true);
        assert.equal(warCrateServerAuthEnabled(), true);
        localStorage.setItem("warCrateServerAuth.v1", "false");
        assert.equal(warCrateServerAuthEnabled(), true);           // only literal "0" disables
    } finally {
        delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    }
});

test("warCrateServerAuth: OFF when storage is unavailable", () => {
    delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
    assert.equal(warCrateServerAuthEnabled(), false);
});
