/*
 * The people of the coast: who a player sees standing at the places the quests
 * talk about, and the one thing each of them says.
 *
 * The story is about people. A commander cuts families off a roll, a patrol
 * takes a third of the landing's fish, sixty people wait at a cairn with no
 * count. Until this, a player was told about all of them and saw none. A
 * resident is somebody to look at and one line to hear, and the line is picked
 * from that player's own record, so what they did shows in what people say.
 *
 * Presentation only. A resident gives nothing, starts nothing and blocks
 * nothing. Every figure wears a world model the game already has (owner
 * ruling: no new character art) and names the painted face that goes with it,
 * so it is still drawn for a player who chose 2D figures.
 *
 * The lines keep the script's rules (api/quests/_coast-script.ts): an actor
 * could say them, plain words, contractions, 55 words or fewer, no dash used
 * as a pause. A line that is not speech is what the shinobi sees.
 */
import { coastExits, coastLayout, coastSite, coastSitesInSector } from '../../shared/coast-world.js';
import type { QuestEngineDeps } from './_engine.js';
import type { QuestLinesRecord } from './_record.js';

export interface CoastResident {
    sector: number;
    /** An open tile beside the place they belong to. Never a road, a doorway or a trail's end. */
    tile: number;
    /** Who they are, for hover and screen readers. */
    label: string;
    /** An existing world model. */
    model: string;
    /** The painted face that goes with the model (castFaceOf in _views.ts), drawn when world models are off. */
    face: string;
    /** What choosing them shows. Speech is in quotation marks; anything else is what the shinobi sees. */
    say: string;
}

type Record_ = QuestLinesRecord;
const finished = (record: Record_, id: string) => Object.hasOwn(record.done, id);
const chose = (record: Record_, id: string, stage: string) => record.done[id]?.choices?.[stage];
const speech = (text: string) => `“${text}”`;

interface Person { label: string; model: string; face: string; says: (record: Record_) => string }
interface Group {
    sector: number;
    /** The site they stand beside. */
    site: (sector: number) => string | undefined;
    /** Absent means they are always there. */
    when?: (record: Record_, deps: Pick<QuestEngineDeps, 'catalogue'>) => boolean;
    people: readonly Person[];
}

/** True while the quest is under way and the player is on one of the named steps. */
function onStep(record: Record_, deps: Pick<QuestEngineDeps, 'catalogue'>, questId: string, keys: readonly string[]): boolean {
    const active = Object.hasOwn(record.active, questId) ? record.active[questId] : undefined;
    const line = deps.catalogue.lines[questId];
    return !!active && !!line && keys.includes(line.stages[active.stage]?.key ?? '');
}

const onlySite = (sector: number) => coastSitesInSector(sector)[0]?.id;

export const COAST_RESIDENT_GROUPS: readonly Group[] = [
    // The settlement beside the Record House: the families the first three quests are about. Their doorposts carry
    // the marks that are carved on the garrison gate and burned into the commander's tally sticks, a third of them
    // scraped off. What they say follows what the player did about that.
    {
        sector: 105, site: () => 'saltstair-houses-105',
        people: [
            { label: 'A woman at her door', model: 'medic', face: 'medic', says: record => speech(
                !finished(record, 'crossing-war-1') ? 'Half these doors had a mark burned in when I was a girl. Look at them now. Somebody up the stair decides who’s a family and who isn’t.'
                    : chose(record, 'crossing-war-1', 'tallies') === 'carry' ? 'Orito came down himself and read our names out, door by door. My mother’s mark is back on the roll. I didn’t think I’d ever cry over a clerk.'
                        : 'They say the commander’s been beaten. Our mark’s still scraped off the post. Beating a man doesn’t put a name back.') },
            { label: 'An old man on the stair', model: 'pilgrim', face: 'pilgrim', says: record => speech(
                !finished(record, 'the-unmoored') ? 'My father carried me up this stair on his back. He said we’d left the counting behind. He was wrong about that, but he meant well.'
                    : chose(record, 'the-unmoored', 'ask') === 'open' ? 'Boats from the villages, after all this time. I’d like to see where my father came from. I’m too old to be afraid of a list.'
                        : 'So the coast stays shut. Good. I’ve seen what comes off a boat, and it’s never only the people on it.') },
            { label: 'A water carrier', model: 'courier', face: 'courier', says: record => speech(
                finished(record, 'first-footing') ? 'You put a mark on the garrison gate. I saw it. My brother says they’ll plane it off by winter. I say they won’t.'
                    : 'Are you really from across the water? They told us you count the children there. Do you? How many are there?') },
            { label: 'A cook carrying salt', model: 'merchant', face: 'merchant', says: record => speech(
                finished(record, 'tale-shoal-toll') ? 'Fish came up the stair by the basket this week. It’s the first time the kettle’s been full since spring. Go in and eat.'
                    : 'There’s soup in the cook house if you’re hungry. We feed whoever climbs the stair. Nobody gets asked for paper at the kettle.') },
            { label: 'A man mending a roof', model: 'tracker', face: 'tracker', says: record => speech(
                finished(record, 'crossing-war-1') ? 'I haven’t seen a garrison man on this stair in days. I keep looking up for them. It’s a hard habit to drop.'
                    : 'Garrison men come down twice a month and look at the doorposts. They don’t say anything. They don’t have to.') },
            { label: 'A woman sitting apart', model: 'gambler', face: 'gambler', says: record => speech(
                finished(record, 'uncounted-3') ? 'Sixty of us went over the pass with a count to our names. I stayed. Somebody has to be here when the rest come looking.'
                    : finished(record, 'uncounted-1') ? 'They say a woman at the quay is getting people like me across. I’ve been off the roll thirty years. I’d go tomorrow.'
                        : 'I don’t live here. Not on paper. I sleep in the third house and eat at the kettle, and nobody’s written any of it down.') },
        ],
    },
    // Needle Shoal: the people of the landing, fishing for their supper (The Shoal Toll).
    {
        sector: 104, site: onlySite,
        people: [
            { label: 'A fisher on the rocks', model: 'angler', face: 'angler', says: record => speech(
                finished(record, 'tale-shoal-toll') ? 'Nobody came down for a share last night. I ate my whole catch, and I didn’t know what to do with myself.'
                    : finished(record, 'crossing-war-1') ? 'The commander’s gone quiet since somebody beat him. His men still come down for the fish.'
                        : 'A third of this goes up the stair at dusk. They call it the garrison’s share. I call it my supper.') },
            { label: 'A net mender', model: 'pilgrim', face: 'pilgrim', says: record => speech(
                finished(record, 'the-unmoored') ? (chose(record, 'the-unmoored', 'ask') === 'open'
                    ? 'They tell me the coast is open. I’ve mended nets here forty years. I suppose I’ll mend them for strangers now.'
                    : 'They say the coast stays shut. That’s fine by me. The fish don’t care who’s allowed in.')
                    : finished(record, 'first-footing') ? 'They say a village shinobi walked through the garrison gate on a strip of cord. Was that you?'
                        : 'You’re from across the water. So was my grandmother. She never said which village, and I never asked.') },
            { label: 'A basket carrier', model: 'merchant', face: 'merchant', says: record => speech(
                !finished(record, 'crossing-war-1') ? 'My family’s been off the roll two winters. Don’t ask me why. Ask the commander, if you can get near him.'
                    : chose(record, 'crossing-war-1', 'tallies') === 'carry' ? 'My family was cut off the roll two winters back. Orito wrote us in again last week. I can draw a ration for the first time since.'
                        : 'My family was cut off the roll two winters back. No ration and no say. We fish, and we keep our heads down.') },
        ],
    },
    // The Remakers' workshop: the people who cast every tool the heights use.
    {
        sector: 144, site: () => 'hushcrown-counter-144',
        people: [
            { label: 'A remaker at the bench', model: 'tracker', face: 'tracker', says: record => speech(
                finished(record, 'the-unmoored') ? (chose(record, 'the-unmoored', 'ask') === 'open'
                    ? 'If boats are coming, they’ll want fittings. I’ve started a second mould.'
                    : 'Shut or open, somebody still needs caps and needle points. I’m not short of work.')
                    : finished(record, 'crossing-war-5') ? 'You broke the Double Watch with tools made on this bench. I cast those caps. I’d like that kept quiet.'
                        : 'We don’t make new things up here. We make the old ones again, the same way, so nobody forgets how.') },
            { label: 'A remaker sorting grit', model: 'medic', face: 'medic', says: record => speech(
                finished(record, 'the-unmoored') ? 'I hear she let Orito write her name. It took her long enough. The rest of us have had names all along.'
                    : 'Grit goes into everything. Caps, links, needle points. If your hands are black, you’ve been useful.') },
        ],
    },
    // The Last Dispatch Cairn: the uncounted, waiting to be taken over the pass (The Uncounted III).
    {
        sector: 140, site: () => 'whitecrown-tracks-140',
        when: (record, deps) => onStep(record, deps, 'uncounted-3', ['cairn', 'captain']),
        people: [
            { label: 'A man with a pack', model: 'courier', face: 'courier', says: () => speech('We walked three nights to get here. If that pass of yours is no good, we walk three nights back, and some of us won’t make it.') },
            { label: 'A woman holding a child’s hand', model: 'medic', face: 'medic', says: () => speech('Don’t tell me it’ll be fine. Just tell me when to walk.') },
            { label: 'An old woman sitting on her bundle', model: 'pilgrim', face: 'pilgrim', says: () => speech('I was born up here. I’m on no roll, so I was never anybody’s to feed. I’d like to be somebody’s trouble for once.') },
            { label: 'A girl counting under her breath', model: 'gambler', face: 'gambler', says: () => speech('Fifty eight. Fifty nine. I keep losing count when somebody moves.') },
        ],
    },
    // The Wind Collar: the boy the relief watch left behind (The Crossing War: Rime Lock).
    {
        sector: 137, site: () => 'whitecrown-tracks-137',
        when: (record, deps) => onStep(record, deps, 'crossing-war-4', ['sentry', 'chain', 'warden']),
        people: [
            { label: 'A boy of the watch', model: 'courier', face: 'courier', says: (record) => {
                // The choice is sealed on the quest while it is under way, and read from there.
                const picked = record.active['crossing-war-4']?.choices?.sentry;
                return picked === 'warm' ? 'There is a fire going beside him now. He is holding his hands out to it and watching the track you came by.'
                    : picked === 'pass' ? 'He has not moved since you went by. His head is still down.'
                        : 'He does not look up. His hands are tucked under his arms, and he has stopped shivering.';
            } },
        ],
    },
];

const GRID = 12;

/**
 * Where a group stands: the open ground nearest the site's entrance, off the
 * roads. Patrols stand only on road tiles (api/coast/_patrols.ts), so a
 * resident and a patrol never share one. No two residents stand side by side.
 */
export function residentTiles(sector: number, siteId: string, count: number): number[] {
    const layout = coastLayout(sector), site = coastSite(siteId);
    if (!layout || !site || site.sector !== sector) return [];
    const blocked = new Set<number>([...Object.values(layout.sites).map(entry => entry.approach), ...coastExits(sector).map(exit => exit.tile)]);
    const col = (tile: number) => tile % GRID, row = (tile: number) => Math.floor(tile / GRID);
    const reach = (tile: number) => Math.max(Math.abs(col(tile) - col(site.approach)), Math.abs(row(tile) - row(site.approach)));
    const open: number[] = [];
    layout.mask.forEach((cells, y) => [...cells].forEach((cell, x) => {
        const tile = y * GRID + x;
        if (cell === '.' && !blocked.has(tile)) open.push(tile);
    }));
    open.sort((a, b) => reach(a) - reach(b) || a - b);
    const taken: number[] = [];
    for (const tile of open) {
        if (taken.length >= count) break;
        if (taken.some(other => Math.abs(col(other) - col(tile)) + Math.abs(row(other) - row(tile)) <= 1)) continue;
        taken.push(tile);
    }
    return taken;
}

/** Everyone this player would see standing on the coast, with what each says to them. */
export function coastResidents(deps: Pick<QuestEngineDeps, 'catalogue'>, record: QuestLinesRecord): CoastResident[] {
    const out: CoastResident[] = [];
    for (const group of COAST_RESIDENT_GROUPS) {
        if (group.when && !group.when(record, deps)) continue;
        const siteId = group.site(group.sector);
        if (!siteId) continue;
        const tiles = residentTiles(group.sector, siteId, group.people.length);
        group.people.forEach((person, index) => {
            // A sector with too little open ground shows fewer people, never one on a road.
            if (tiles[index] === undefined) return;
            out.push({ sector: group.sector, tile: tiles[index], label: person.label, model: person.model, face: person.face, say: person.says(record) });
        });
    }
    return out;
}
