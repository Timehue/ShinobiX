import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TREASURY_GIFT_TAX_PCT } from './_treasury-gift-tax';

/*
 * The treasury screens quote two server numbers back to the player: the gift
 * levy and the per-donation ryo cap. Neither is enforced client-side, so a drift
 * is silent — the UI keeps promising the old number while the server applies the
 * new one, and the player only finds out at the moment of rejection. That is
 * exactly how three client/server price mismatches survived in this codebase
 * (fate dice, the Kage challenge, the black market) until they were audited out.
 */

const read = (...seg: string[]) => readFileSync(join(process.cwd(), ...seg), 'utf8');

const SCREENS: { file: string; label: RegExp; cap: RegExp; donate: string[] }[] = [
    {
        file: 'TownHall.tsx',
        label: /TREASURY_GIFT_TAX_LABEL\s*=\s*"(\d+)%"/,
        cap: /TREASURY_DONATE_MAX_RYO\s*=\s*([\d_]+)/,
        donate: ['api', 'village', 'treasury', 'donate.ts'],
    },
    {
        file: 'ClanHall.tsx',
        label: /CLAN_GIFT_TAX_LABEL\s*=\s*"(\d+)%"/,
        cap: /CLAN_DONATE_MAX_RYO\s*=\s*([\d_]+)/,
        donate: ['api', 'clan', 'treasury', 'donate.ts'],
    },
];

describe('treasury UI quotes the server’s own numbers', () => {
    for (const screen of SCREENS) {
        const src = read('shinobij.client', 'src', 'screens', screen.file);

        it(`${screen.file} quotes the real gift levy`, () => {
            const m = src.match(screen.label);
            assert.ok(m, `${screen.file} must declare its gift-tax label`);
            assert.equal(
                Number(m![1]) / 100,
                TREASURY_GIFT_TAX_PCT,
                `${screen.file} advertises ${m![1]}% but the server burns ${TREASURY_GIFT_TAX_PCT * 100}%`,
            );
        });

        it(`${screen.file} caps the donate field at the server's ryo limit`, () => {
            const m = src.match(screen.cap);
            assert.ok(m, `${screen.file} must declare its donate cap`);
            const serverCap = read(...screen.donate).match(/ryo:\s*([\d_]+)/);
            assert.ok(serverCap, `${screen.donate.join('/')} must declare a ryo cap`);
            assert.equal(
                Number(m![1].replace(/_/g, '')),
                Number(serverCap![1].replace(/_/g, '')),
                `${screen.file} lets the player enter a ryo amount the server will reject`,
            );
        });

        it(`${screen.file} reports the burn instead of swallowing it`, () => {
            assert.match(src, /burned in transit/, `${screen.file} must tell the player what the levy took`);
        });
    }
});
