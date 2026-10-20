import {createHash} from 'node:crypto';

/** Historical identification used only by the rejected-attempt regression.
 * Production certification no longer imports or grants this old allowance. */
export function reviewedPebbleScalp(glb, primitive, id, component, reader) {
    if (id !== 'starter-earth' || createHash('sha256').update(glb.file).digest('hex') !== 'c99b0471489b65a5fe2c4b9b50bf781c48f4820f7eacdb092cf983a15ca51894') return false;
    const recipe = glb.json.extras?.pebbleDistinctRebuild;
    if (recipe?.revision !== '20261019-pebble-distinct-model-v1' || recipe.sharedStoneTurtleGeometry !== false || recipe.removedCapTriangles !== 2499 || recipe.scalpVertices !== 1006) return false;
    if (component.triangles !== 1785 || component.vertices.size !== 1006) return false;
    const position = reader(glb, primitive.attributes.POSITION), uv = reader(glb, primitive.attributes.TEXCOORD_0);
    const weights = reader(glb, primitive.attributes.WEIGHTS_0), joints = reader(glb, primitive.attributes.JOINTS_0);
    const head = glb.json.skins[0].joints.findIndex(node => glb.json.nodes[node].name === 'head');
    if (head < 0) return false;
    for (const vertex of component.vertices) {
        const p = [0,1,2].map(axis => position.value(vertex, axis));
        if (Math.abs(p[0]) > .601 || p[1] < .419 || p[1] > .986 || p[2] < -.471 || p[2] > .782) return false;
        if (Math.abs(uv.value(vertex,0) - .6971999406814575) > 1e-7 || Math.abs(uv.value(vertex,1) - .6212405562400818) > 1e-7) return false;
        let share = 0;
        for (let k=0;k<4;k++) if (joints.value(vertex,k) === head) share += weights.value(vertex,k);
        if (share < .999999) return false;
    }
    return true;
}
