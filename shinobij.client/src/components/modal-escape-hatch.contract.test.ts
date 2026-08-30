import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

/*
 * "An escape hatch a busy flag can disable is no hatch at all."
 *
 * SessionExpiredModal learned this the hard way: a hung verify trapped the
 * player behind it with every control dead. Four more overlays turned out to
 * have the same shape — SageOfferModal, ClanExchange, HollowGateAttunement and
 * Shop each gated ALL of their exits on one busy flag, so a single request that
 * never settled left the player with only a page refresh out.
 *
 * That is not a theoretical hang. Every one of those calls bottoms out in a
 * bare fetch with no AbortController and no timeout, and the surrounding catch
 * only fires on a network error, never on a stalled connection.
 *
 * The rule these encode: the COMMITTING action may be disabled while busy, and
 * the backdrop may stay guarded against an accidental click, but at least one
 * deliberate way out must always work.
 */

const srcDir = join(process.cwd(), 'shinobij.client', 'src');

/** Put this on the offending line if an overlay genuinely must not be escapable. */
const EXEMPT = 'escape-hatch-exempt';

/**
 * Handlers that DISMISS an overlay. Committing actions that happen to end it —
 * decline, confirm, purchase, accept — are deliberately absent: those are
 * correct to disable while in flight.
 */
const EXIT_HANDLER = /(?:close|dismiss)/i;

/** Flag names that mean "a request is in flight". */
const BUSYISH = /busy|pending|inflight|submitting/i;

const posix = (file: string): string => relative(srcDir, file).split(sep).join('/');

function tsxFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = join(directory, entry.name);
        if (entry.isDirectory()) return tsxFiles(target);
        return entry.name.endsWith('.tsx') ? [target] : [];
    });
}

/**
 * Slice out each `<tag ...>` opening element. Tracks brace depth so that a `>`
 * inside an attribute — every `() =>` arrow — does not end the element early.
 */
function openingTags(text: string, tag: string): string[] {
    const found: string[] = [];
    const opener = new RegExp(`<${tag}\\b`, 'g');
    for (let match = opener.exec(text); match; match = opener.exec(text)) {
        let depth = 0;
        for (let i = match.index; i < text.length; i += 1) {
            const ch = text[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (ch === '>' && depth === 0) {
                found.push(text.slice(match.index, i + 1));
                break;
            }
        }
    }
    return found;
}

const attribute = (element: string, name: string): string =>
    new RegExp(`${name}=\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}`).exec(element)?.[1] ?? '';

const files = tsxFiles(srcDir);

test('the scan actually reaches the overlays it exists to police', () => {
    // Without this, a broken walker turns every assertion below into a no-op
    // that passes forever. These four are the historical offenders.
    const seen = files.map(posix);
    for (const overlay of [
        'components/SageOfferModal.tsx',
        'components/ClanExchange.tsx',
        'components/HollowGateAttunement.tsx',
        'components/Shop.tsx',
    ]) {
        assert.ok(seen.includes(overlay), `${overlay} is no longer being scanned`);
    }
    const shop = readFileSync(join(srcDir, 'components', 'Shop.tsx'), 'utf8');
    assert.ok(openingTags(shop, 'button').length > 0, 'the element slicer stopped matching buttons');
    assert.ok(
        attribute('<button onClick={closeItem} disabled={purchaseBusy}>', 'disabled') === 'purchaseBusy',
        'the attribute reader stopped resolving values',
    );
});

test('no dismiss handler is gated behind a busy flag', () => {
    // `const close = useCallback(() => { if (!busyRef.current) onClose(); })`
    // is the exact idiom that killed Escape in all four overlays.
    const gated =
        /const\s+\w*(?:close|dismiss)\w*\s*=\s*useCallback\(\s*\(\s*\)\s*=>\s*\{?\s*if\s*\(\s*!\s*\w*(?:busy|pending|inflight|submitting)/gi;
    const offenders: string[] = [];
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(gated)) {
            if (!text.slice(match.index, match.index + 400).includes(EXEMPT)) {
                offenders.push(`${posix(file)} -> ${match[0].split('\n')[0].trim()}`);
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `these silently swallow Escape while a request is in flight, so a stalled call traps the player: ${offenders.join(', ')}`,
    );
});

test('no exit control is disabled by a busy flag', () => {
    const offenders: string[] = [];
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const tag of ['button', 'CloseButton']) {
            for (const element of openingTags(text, tag)) {
                if (element.includes(EXEMPT)) continue;
                if (!EXIT_HANDLER.test(attribute(element, 'onClick'))) continue;
                const disabled = attribute(element, 'disabled');
                if (disabled && BUSYISH.test(disabled)) {
                    offenders.push(`${posix(file)} -> disabled={${disabled}}`);
                }
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `a player cannot leave once these go dead; disable the committing action instead: ${offenders.join(', ')}`,
    );
});
