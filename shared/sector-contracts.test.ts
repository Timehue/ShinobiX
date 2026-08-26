import assert from "node:assert/strict";
import test from "node:test";
import { WILD_SECTOR_IDS } from "./sector-geo.js";
import {
    CONTRACT_RYO_BASE, CONTRACT_RYO_PER_SECTOR, CONTRACT_TARGET_MIN, CONTRACT_TARGET_SPREAD,
    SECTOR_CONTRACT_SLOTS, contractAcceptsWorkAt, contractSectorsForDay, sectorContractFor,
    sectorContractObjective, utcDayOf,
} from "./sector-contracts.js";

const DAYS = ["2026-08-25", "2026-08-26", "2026-09-01", "2027-01-31"];

test("exactly SECTOR_CONTRACT_SLOTS sectors are posted, every day, all wild", () => {
    for (const day of DAYS) {
        const posted = contractSectorsForDay(day);
        assert.equal(posted.length, SECTOR_CONTRACT_SLOTS, day);
        assert.equal(new Set(posted).size, posted.length, `${day} posted a duplicate`);
        for (const sector of posted) assert.ok(WILD_SECTOR_IDS.includes(sector), `${day} posted ${sector}`);
        assert.deepEqual(posted, [...posted].sort((a, b) => a - b), "posted list must be ascending");
    }
});

test("the day's board is deterministic, and different days post different boards", () => {
    for (const day of DAYS) assert.deepEqual(contractSectorsForDay(day), contractSectorsForDay(day));
    // Not a guarantee for any specific pair, but four consecutive boards being
    // identical would mean the day is not actually feeding the hash.
    const boards = DAYS.map((day) => contractSectorsForDay(day).join(","));
    assert.ok(new Set(boards).size > 1, "the day must change the board");
});

test("a contract exists exactly for the posted sectors and is recomputable", () => {
    const day = "2026-08-25";
    const posted = new Set(contractSectorsForDay(day));
    for (const sector of WILD_SECTOR_IDS) {
        const contract = sectorContractFor(sector, day);
        if (!posted.has(sector)) {
            assert.equal(contract, null, `sector ${sector} is not posted`);
            continue;
        }
        assert.ok(contract, `sector ${sector} is posted`);
        assert.equal(contract.sector, sector);
        assert.equal(contract.day, day);
        assert.deepEqual(contract, sectorContractFor(sector, day), "must recompute identically");
    }
});

test("targets and payouts stay inside their authored bands", () => {
    for (const day of DAYS) {
        for (const sector of contractSectorsForDay(day)) {
            const contract = sectorContractFor(sector, day)!;
            assert.ok(contract.target >= CONTRACT_TARGET_MIN, `${day}/${sector} target too low`);
            assert.ok(contract.target < CONTRACT_TARGET_MIN + CONTRACT_TARGET_SPREAD, `${day}/${sector} target too high`);
            assert.equal(contract.ryo, CONTRACT_RYO_BASE + sector * CONTRACT_RYO_PER_SECTOR);
        }
    }
});

test("chasing every posted contract cannot consume a player's daily explore ceiling", () => {
    const DAILY_SECTOR_EXPLORE_LIMIT = 150;   // api/world/explore.ts
    for (const day of DAYS) {
        const cost = contractSectorsForDay(day)
            .reduce((sum, sector) => sum + sectorContractFor(sector, day)!.target, 0);
        assert.ok(cost < DAILY_SECTOR_EXPLORE_LIMIT, `${day} asks ${cost} of ${DAILY_SECTOR_EXPLORE_LIMIT} explores`);
    }
});

test("non-wild sectors are never posted and never carry a contract", () => {
    const day = "2026-08-25";
    for (const sector of [0, -1, 99, 1000, 1.5, Number.NaN]) {
        assert.equal(sectorContractFor(sector, day), null, `sector ${sector}`);
    }
});

test("the UTC day is read off the clock, not the local timezone", () => {
    assert.equal(utcDayOf(Date.UTC(2026, 7, 25, 23, 59, 59)), "2026-08-25");
    assert.equal(utcDayOf(Date.UTC(2026, 7, 26, 0, 0, 0)), "2026-08-26");
});

test("night work is a minority of the board, and stable for a given day", () => {
    for (const day of DAYS) {
        const posted = contractSectorsForDay(day);
        const night = posted.filter((sector) => sectorContractFor(sector, day)!.nightOnly);
        assert.ok(night.length < posted.length, `${day}: every posting was night work`);
        // Same day, same answer.
        for (const sector of posted) {
            assert.equal(sectorContractFor(sector, day)!.nightOnly, sectorContractFor(sector, day)!.nightOnly);
        }
    }
});

test("a day-lit player is never locked out — ordinary postings always remain", () => {
    for (const day of DAYS) {
        const daytime = contractSectorsForDay(day).filter((sector) => !sectorContractFor(sector, day)!.nightOnly);
        assert.ok(daytime.length >= 2, `${day} left only ${daytime.length} daytime contracts`);
    }
});

test("night contracts accept work only after dark; ordinary ones always do", () => {
    const day = "2026-08-26";
    const noon = Date.UTC(2026, 7, 26, 12);
    const midnight = Date.UTC(2026, 7, 26, 23);
    for (const sector of contractSectorsForDay(day)) {
        const contract = sectorContractFor(sector, day)!;
        assert.equal(contractAcceptsWorkAt(contract, midnight), true, `sector ${sector} at night`);
        assert.equal(contractAcceptsWorkAt(contract, noon), !contract.nightOnly, `sector ${sector} at noon`);
    }
});

test("night work pays no premium — the condition buys direction, not income", () => {
    for (const day of DAYS) {
        for (const sector of contractSectorsForDay(day)) {
            const contract = sectorContractFor(sector, day)!;
            assert.equal(contract.ryo, CONTRACT_RYO_BASE + sector * CONTRACT_RYO_PER_SECTOR);
        }
    }
});

test("the objective names the window a night contract needs", () => {
    const day = "2026-08-26";
    for (const sector of contractSectorsForDay(day)) {
        const contract = sectorContractFor(sector, day)!;
        const text = sectorContractObjective(contract);
        assert.match(text, new RegExp(`${contract.target}`));
        if (contract.nightOnly) assert.match(text, /after dark \(20:00–05:00 UTC\)/u);
        else assert.doesNotMatch(text, /after dark/u);
    }
});
