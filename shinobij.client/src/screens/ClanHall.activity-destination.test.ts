import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ACTIVITY_SECTION_EVENT, openActivityDestination, readActivitySection } from '../lib/activity-spine-navigation';
import type { ActivitySpineItem } from '../../../shared/activity-spine';

/*
 * An activity recommendation that promises to open a clan goal has to land on
 * it. A fresh Clan Hall opens on the Exchange, so "Review your clan's next
 * goal" used to drop the player on the trading tab with no sign of the goal it
 * had just described. Source-level for the screen itself, which cannot be
 * rendered in node without its whole App graph.
 */
const screen = readFileSync(new URL('./ClanHall.tsx', import.meta.url), 'utf8');

test('the Clan Hall opens on the goal board when an activity asks for it', () => {
    // The one-shot hint is honoured on a fresh mount…
    assert.match(screen, /return initial === "boss" \|\| initial === "territory" \|\| initial === "missions" \? initial : "exchange";/);
    // …and on a Clan Hall that is already open on another tab.
    assert.match(screen, /useActivitySectionRequests\("clan\.initialView", \["boss", "missions"\], setView\)/);
    // Ordinary entry is unchanged: without a hint the Hall still opens on the Exchange.
    assert.match(screen, /} catch \{ return "exchange"; \}/);
    // The goal board is a real tab with the clan's objectives, progress and rewards.
    assert.match(screen, /view === "missions" && <div className="clan-mission-grid">/);
    assert.match(screen, /clanMissionProgress\(clanData, mission\.key\)/);
});

test('a hint is consumed once, so a manual tab choice is never overridden later', () => {
    // Removed after the mount commits (Strict Mode may run the initializer twice).
    assert.match(screen, /useLayoutEffect\(\(\) => \{[\s\S]*?sessionStorage\.removeItem\("clan\.initialView"\);/);
    // Only an explicit new request switches a mounted Hall; nothing re-reads
    // the hint on every render.
    assert.equal(screen.match(/sessionStorage\.getItem\("clan\.initialView"\)/g)?.length, 1);
});

test('the clan-goals hint travels end to end, and an unusable one is refused', () => {
    const data = new Map<string, string>();
    const events: Array<{ key?: string; section?: string }> = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
    } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        dispatchEvent: (event: CustomEvent<{ key?: string; section?: string }>) => {
            if (event.type === ACTIVITY_SECTION_EVENT) events.push(event.detail);
            return true;
        },
        CustomEvent: globalThis.CustomEvent,
    } });
    try {
        const navigated: string[] = [];
        const opened = openActivityDestination({ screen: 'clan', section: 'clan-goals' } as ActivitySpineItem, s => navigated.push(s));
        assert.equal(opened, true);
        assert.deepEqual(navigated, ['clan']);
        // A newly mounted Clan Hall reads the hint…
        assert.equal(data.get('clan.initialView'), 'missions');
        assert.equal(readActivitySection('clan.initialView', ['boss', 'missions', 'exchange'], 'exchange'), 'missions');
        // …and one already on screen is told directly.
        assert.deepEqual(events, [{ key: 'clan.initialView', section: 'missions' }]);

        // A hint the Clan Hall does not support never navigates or is stored.
        data.clear();
        assert.equal(openActivityDestination({ screen: 'clan', section: 'legacy' } as ActivitySpineItem, () => assert.fail('must not navigate')), false);
        assert.equal(data.size, 0);
        // A stale value that is not a supported tab falls back to the Hall's own view.
        data.set('clan.initialView', 'treasury');
        assert.equal(readActivitySection('clan.initialView', ['boss', 'missions', 'exchange'], 'exchange'), 'exchange');
    } finally {
        if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
        else Reflect.deleteProperty(globalThis, 'sessionStorage');
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});
