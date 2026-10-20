import type { LIFE_TRAVELERS, LifeEventKind } from './sector-life-content.js';
import type { LifeEventView } from './sector-life.js';
import type { SectorScar } from './sector-scars.js';
import {DOCK_SHIPMENT_SCENARIO,DOCK_SHIPMENT_LINES} from './sector-dock-shipment.js';

export const LIFE_TRAVELER_CONTEXT = {
    tetsu:{weather:"I'm keeping the letters covered until this passes.",night:"I'm checking the next bundle before I leave."},
    nao:{weather:"I'm waiting here while the view of the road is poor.",night:"I'm resting here before I continue the shrine round."},
    gen:{weather:"I've stopped here to keep out of the worst of this weather.",night:"I'm done cooking for tonight. I'll carry on after a rest."},
    sumi:{weather:"I'm keeping my notes covered until this passes.",night:"I'll check new accounts in the morning. I don't want to miss any details in the dark."},
} as const;
export const LIFE_EVENT_NEWS:Record<LifeEventKind,string>={
    shrine:'The shrine lamps have been tended.',
    supplies:'The delivery worker has the route report.',lanterns:'Both crossings have been checked.',
    tracks:'The tracker has finished the trail round.',courier:'The missing courier made it back to the road.',
    signal:'The watch approaches have been checked.',tea:'The paths beside the tea stop have been checked.',
};

/** The event is current shared state, and the duel is a server-recorded result.
 * Sumi reports the record rather than pretending to have witnessed the fight. */
export function travelerConversation(traveler:typeof LIFE_TRAVELERS[number],weather:string,night:boolean,event?:LifeEventView,scar?:SectorScar) {
    const current=LIFE_TRAVELER_CONTEXT[traveler.id];
    const context=['rain','thunderstorm','tornado','ashfall'].includes(weather)?current.weather:night?current.night
        :traveler.id==='sumi'&&scar&&scar.fallen?`The local duel record names ${scar.victor} as the winner against ${scar.fallen}. I'm checking the details.`
        :event?.phase==='aftermath'?event.scenario===DOCK_SHIPMENT_SCENARIO?DOCK_SHIPMENT_LINES.news:LIFE_EVENT_NEWS[event.kind]:undefined;
    return context?{line:context,returnGreeting:`Good to see you again. ${context}`}:{line:traveler.greeting,returnGreeting:traveler.again};
}
