/** Public preparation information for hired WAR NPCs only; never human war participants. */
export function warMercenaryCombatProfile(level: number) {
    if (level >= 100) return { classification: 'special-npc', role: 'Warlord',
        tactics: 'Armored commander: Wound limits healing while Absorb and weapon Reflect cover its burst rotation.' };
    if (level >= 95) return { classification: 'special-npc', role: 'Oni',
        tactics: 'Pressure fighter: Poison punishes repeated casting and Reflect punishes attacking through its stance.' };
    if (level >= 85) return { classification: 'special-npc', role: 'Shadow',
        tactics: 'Sustain hunter: two Wound chains limit healing and Siphon rewards an unbroken attack rotation.' };
    if (level >= 80) return { classification: 'special-npc', role: 'Reaver',
        tactics: 'Chain fighter: Wound and Siphon pressure sustain builds; damage focus opens a burst window.' };
    return { classification: 'special-npc', role: 'Ronin',
        tactics: 'Veteran duelist: damage focus sets up elemental strikes, with Wound and Poison to pressure recovery.' };
}
