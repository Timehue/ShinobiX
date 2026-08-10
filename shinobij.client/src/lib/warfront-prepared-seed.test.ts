import test from "node:test";
import assert from "node:assert/strict";
import {
    PREPARED_WARFRONT_SEED_KEY,
    clearPreparedWarfrontContract,
    parsePreparedWarfrontContract,
    preparedWarfrontStorageKey,
    readPreparedWarfrontContract,
    writePreparedWarfrontContract,
    type PreparedWarfrontContract,
} from "./warfront-prepared-seed.ts";

class MemoryStorage {
    readonly values = new Map<string, string>();
    get length(): number { return this.values.size; }
    clear(): void { this.values.clear(); }
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
    removeItem(key: string): void { this.values.delete(key); }
    setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

const withMemoryStorage = (run: (storage: MemoryStorage) => void): void => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try { run(storage); }
    finally {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
};

const preparedContract = (prepareToken: string): PreparedWarfrontContract => ({
    prepareToken,
    scoutedDoctrineOptions: ["bulwark", "zealot"],
    scoutedWarband: { version: 1, id: "siege", name: "Iron Lanterns", style: "Slow siege pressure with a fortified escort." },
    preparedAt: 1_800_000_000_000,
});

test("prepared Warfront scouting contract preserves only the opaque grant, partial read, and warband tell", () => {
    const contract = {
        prepareToken: "abcdef0123456789abcdef0123456789",
        scoutedDoctrineOptions: ["bulwark", "zealot"],
        scoutedWarband: { version: 1, id: "siege", name: "Iron Lanterns", style: "Slow siege pressure with a fortified escort." },
        preparedAt: 1_800_000_000_000,
    } as const;
    assert.deepEqual(parsePreparedWarfrontContract(contract), contract);
    assert.equal("seed" in parsePreparedWarfrontContract({ ...contract, seed: 123456 })!, false,
        "the parser must not retain a pre-commit battlefield seed");
    assert.equal("scoutedDoctrine" in parsePreparedWarfrontContract({ ...contract, scoutedDoctrine: "bulwark" })!, false,
        "the parser must not retain an exact pre-commit doctrine reveal");
});

test("a local seed or malformed partial scout without its server grant cannot become a prepared contract", () => {
    assert.equal(parsePreparedWarfrontContract({ seed: 123456 }), null);
    const base = {
        prepareToken: "abcdef0123456789",
        scoutedDoctrineOptions: ["vanguard", "bulwark"],
        scoutedWarband: { version: 1, id: "ambush", name: "Night Knives", style: "Fast backline pressure." },
        preparedAt: 1,
    } as const;
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedDoctrineOptions: ["vanguard", "forged"] }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedDoctrineOptions: ["vanguard", "vanguard"] }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedDoctrineOptions: ["vanguard"] }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedWarband: { ...base.scoutedWarband, id: "forged" } }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedWarband: { ...base.scoutedWarband, version: 2 } }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, scoutedWarband: { ...base.scoutedWarband, style: "" } }), null);
    assert.equal(parsePreparedWarfrontContract({ ...base, prepareToken: "tampered!" }), null);
});

test("prepared scouting grants are isolated per normalized player identity", { concurrency: false }, () => {
    withMemoryStorage(() => {
        const kakashi = preparedContract("abcdef0123456789abcdef0123456789");
        const obito = preparedContract("0123456789abcdef0123456789abcdef");
        writePreparedWarfrontContract(" Kakashi ", kakashi);
        writePreparedWarfrontContract("Obito", obito);

        assert.deepEqual(readPreparedWarfrontContract("kakashi"), kakashi);
        assert.deepEqual(readPreparedWarfrontContract("OBITO"), obito);
        clearPreparedWarfrontContract("Kakashi", "ffffffffffffffff");
        assert.deepEqual(readPreparedWarfrontContract("kakashi"), kakashi,
            "a mismatched token must not clear the current player's grant");
        clearPreparedWarfrontContract("Kakashi", kakashi.prepareToken);
        assert.equal(readPreparedWarfrontContract("kakashi"), null);
        assert.deepEqual(readPreparedWarfrontContract("obito"), obito,
            "clearing one account must not clear another account's grant");
    });
});

test("the legacy unscoped grant is removed instead of being assigned to the next account", { concurrency: false }, () => {
    withMemoryStorage((storage) => {
        storage.setItem(PREPARED_WARFRONT_SEED_KEY, JSON.stringify(preparedContract("abcdef0123456789")));
        assert.equal(readPreparedWarfrontContract("Sakura"), null);
        assert.equal(storage.getItem(PREPARED_WARFRONT_SEED_KEY), null);
        assert.equal(storage.getItem(preparedWarfrontStorageKey("Sakura")!), null);
    });
});
