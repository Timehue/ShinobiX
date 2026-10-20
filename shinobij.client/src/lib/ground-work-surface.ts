import type {LifeActor} from '../../../shared/sector-life';
import {displayedSectorFloor} from './sector-displayed-floor';

/** A missing/rejected floor must not produce work on invisible planted rows.
 * Read the renderer's actual drawn bitmap using the existing native tick. */
export function groundWorkPresentation<T extends {activity:string;line:string;working?:boolean;surfacePaintings?:readonly string[]}>(actor:LifeActor,presentation:T):T|{activity:string;line:string}{
    if(!presentation.working||!actor.surfaceWork)return presentation;
    const floor=displayedSectorFloor(actor.surfaceWork.sector);
    return (presentation.surfacePaintings??actor.surfaceWork.paintings).some(key=>floor?.endsWith(`/${key}.webp`))?presentation:actor.surfaceWork.fallback;
}
