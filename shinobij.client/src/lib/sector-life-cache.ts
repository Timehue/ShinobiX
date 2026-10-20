import type {LifeSceneView} from '../../../shared/sector-life';

/** Progress is monotonic within one content version. A versioned replacement
 * can restart a legacy round, while a late old-server response cannot undo it. */
export function acceptLifeScene(current:LifeSceneView|undefined,next:LifeSceneView):LifeSceneView{
 if(!current)return next;
 if(current.window>next.window)return current;
 if(current.scenario&&!next.scenario)return current;
 if(next.scenario!==current.scenario)return next;
 return current.window===next.window&&current.step>next.step?current:next;
}
