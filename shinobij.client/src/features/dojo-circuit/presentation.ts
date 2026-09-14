import combatArt from '../../assets/facilities/battle-arena.webp';
import cardArt from '../../assets/card-clash/loc/hidden-dojo.webp';
import petArt from '../../assets/coliseum/pet-duel-hero.webp';
import type { CircuitDiscipline, CircuitPhase } from '../../../../shared/dojo-circuit';
export const DISCIPLINES: Record<CircuitDiscipline, { title: string; seal: string; eyebrow: string; description: string; objective: string; art: string; detail: string }> = {
    combat: { title: 'Shinobi Combat', seal: 'Seal of Courage', eyebrow: 'The first discipline', description: 'Step onto the dojo floor. Let your technique speak.', objective: 'Win a sealed combat spar against the dojo challenger.', art: combatArt,
        detail: 'Face an AI challenger at your level using your current combat loadout. A verified victory earns the Seal of Courage automatically. A defeat costs no Circuit progress; you may try again.' },
    cards: { title: 'Card Clash', seal: 'Seal of Insight', eyebrow: 'The second discipline', description: 'A quiet table. A sharp mind. A story only you can play.', objective: 'Win a Card Hall duel, then return to record your seal.', art: cardArt,
        detail: 'Win an AI duel, then return before closing to record your seal. Player duels record automatically when both sides make at least three meaningful actions, reach turn three, and play for at least 45 seconds. Forfeits, timeouts, and reciprocal win-trading do not qualify. Your Chronicle deck must be unlocked.' },
    pets: { title: 'Companion Battle', seal: 'Seal of Kinship', eyebrow: 'The third discipline', description: 'Stand beside your companion. Earn your place together.', objective: 'Win a rewarded Pet Colosseum bout, then record your seal.', art: petArt,
        detail: 'Choose your companion and enter a paid Colosseum bout. Its normal entry cost and daily reward limit still apply. A rewarded victory qualifies; return before closing to record your Seal of Kinship.' },
};
export const PHASE_LABELS: Record<CircuitPhase, string> = { live: 'Circuit open', upcoming: 'Opening soon', results: 'Closing ceremony', offline: 'Gates closed', unscheduled: 'Between Circuits' };
export function villageTone(village: string) {
    return village.includes('Stormveil') ? 'storm' : village.includes('Ashen') ? 'ember' : village.includes('Frostfang') ? 'frost' : village.includes('Moonshadow') ? 'moon' : 'neutral';
}
export function circuitTime(target: number, now: number) {
    const minutes = Math.max(0, Math.ceil((target - now) / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
export const eventDate = (time: number) => new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
