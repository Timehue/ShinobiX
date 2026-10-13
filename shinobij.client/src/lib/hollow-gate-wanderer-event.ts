import { hollowGateWandererArt, hollowGateWandererName, type HollowGateWanderer } from '../../../shared/hollow-gate-wanderers';
import { resolveHollowGateServerEvent, type HollowGateEventAction, type HollowGateTravelerAction } from './hollow-gate-event-api';
import type { HollowGateTileCtx } from './hollow-gate-tile';
export { hollowGateNearbyTraveler, hollowGateNpcCanTalk } from './hollow-gate-npc-range';

type Gift = { action: HollowGateEventAction | HollowGateTravelerAction; label: string; message: string; tone?: 'safe' | 'primary' };
function openGiftDialog(nodeId: string, title: string, body: string, gifts: Gift[], ctx: HollowGateTileCtx, npc?: HollowGateWanderer) {
    const { character, hollowGateRun: run, setHollowGateEvent, setHollowGateRun, onVersionedCharacter, pushHollowGateLog } = ctx;
    const currentScope = () => ctx.isCurrentRun?.() !== false;
    if (!character || !run?.runToken || !currentScope()) return;
    const interactionId = `${run.runToken}:${run.floor}:${nodeId}`;
    let busy = false;
    const dismiss = () => { if (!busy && currentScope()) setHollowGateEvent(previous => previous?.interactionId === interactionId ? null : previous); };
    const claim = async (gift: Gift) => {
        if (busy || !currentScope()) return;
        busy = true;
        setHollowGateEvent(previous => previous?.interactionId === interactionId ? { ...previous, pending: true, error: undefined } : previous);
        const result = await resolveHollowGateServerEvent({ playerName: character.name, token: run.runToken!, nodeId, action: gift.action });
        busy = false;
        if (!currentScope()) return;
        if (!result.ok) {
            const error = result.error || 'The gift could not be received. Please try again.';
            setHollowGateEvent(previous => previous?.interactionId === interactionId ? { ...previous, pending: false, error } : previous);
            pushHollowGateLog(error); return;
        }
        const accepted = !result.character || onVersionedCharacter(result.character, result._saveVersion);
        setHollowGateRun(previous => !previous || previous.runToken !== run.runToken || previous.floor !== run.floor ? previous : {
            ...previous,
            ...(npc ? { wanderers: previous.wanderers?.map(n => n.nodeId === nodeId ? { ...n, spent: true } : n) }
                : { tiles: previous.tiles.map((t, index) => `floor:${run.floor}:tile:${index}` === nodeId ? { ...t, resolved: true } : t) }),
            ...(accepted && result.runState ? result.runState : {}),
        });
        pushHollowGateLog(gift.message); dismiss();
    };
    setHollowGateEvent({ title, body, image: npc ? hollowGateWandererArt(npc) : '/underground/wanderer-medic-v1.webp',
        eyebrow: npc ? 'Cavern traveler · Friendly' : 'Shrine Keeper · Friendly', kind: 'npc', interactionId, onDismiss: dismiss,
        choices: [...gifts.map(gift => ({ label: gift.label, tone: gift.tone, onSelect: () => { void claim(gift); } })), { label: 'Continue exploring', onSelect: dismiss }] });
}

export function openHollowGateTraveler(npc: HollowGateWanderer, ctx: HollowGateTileCtx) {
    const run = ctx.hollowGateRun;
    if (!run || npc.spent) return;
    const medic = npc.role === 'medic', healingSealed = run.chosenAugment?.id === 'treasure-sense';
    openGiftDialog(npc.nodeId, hollowGateWandererName(npc), medic
        ? `An old medic shelters beneath a jade lantern. “Hold still, shinobi. The Hollow has taken enough.”\n\n${healingSealed ? 'Treasure Sense has sealed healing rites on this dive.' : 'She can restore 33% of your maximum HP once on this floor.'}`
        : 'A relic seeker lowers his lantern. “You look like you could use a friend down here.”\n\nChoose one gift: a Shrine Key for a sealed cache, or a full torch refill. Each traveler offers one gift per floor.',
        medic ? healingSealed ? [] : [{ action: 'traveler-heal', label: 'Accept healing', message: 'The Wandering Medic restores 33% of your maximum HP.', tone: 'safe' }]
            : [{ action: 'traveler-key', label: 'Take a Shrine Key', message: 'The Relic Wayfarer gives you +1 Shrine Key.', tone: 'safe' },
                { action: 'traveler-torch', label: 'Refill the torch', message: 'The Relic Wayfarer rekindles your torch to full.', tone: 'primary' }], ctx, npc);
}

export function openHollowGateKeeper(index: number, flavor: string, ctx: HollowGateTileCtx) {
    const run = ctx.hollowGateRun;
    if (!run || run.tiles[index]?.resolved) return;
    const heal: Gift[] = run.chosenAugment?.id === 'treasure-sense' ? [] : [{ action: 'keeper-heal', label: 'Restore HP (33% of max)', message: 'The Shrine Keeper restores 33% of your maximum HP.', tone: 'primary' }];
    openGiftDialog(`floor:${run.floor}:tile:${index}`, 'The Shrine Keeper', `${flavor}\n\n“Choose your gift, traveler. The shrine offers what it can spare.”`, [
        ...heal, { action: 'keeper-torch', label: 'Refill Torch of Reiki', message: 'The Shrine Keeper rekindles the Torch of Reiki to full.' },
        { action: 'keeper-key', label: 'Gift a Shrine Key', message: 'The Shrine Keeper gives you +1 Shrine Key.' },
    ], ctx);
}
