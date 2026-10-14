/** Shape-preserving Hermite tangents. Pose values and contact times stay exact;
 * cyclic clips share a seam tangent, one-shots settle with zero end velocity. */
export function studioTangents(times, values, width, cyclic = false) {
    const count = times.length, tangents = new Float32Array(values.length);
    const slope = (a, b, axis) => (values[b * width + axis] - values[a * width + axis]) / (times[b] - times[a]);
    const blend = (left, right, a, b) => left * right <= 0 ? 0 : (a + b) / (a / left + b / right);
    for (let axis = 0; axis < width; axis++) {
        for (let i = 1; i < count - 1; i++) {
            const h0 = times[i] - times[i - 1], h1 = times[i + 1] - times[i];
            tangents[i * width + axis] = blend(slope(i - 1, i, axis), slope(i, i + 1, axis), h0 + 2 * h1, 2 * h0 + h1);
        }
        if (cyclic && count > 2) {
            const h0 = times[count - 1] - times[count - 2], h1 = times[1] - times[0];
            const tangent = blend(slope(count - 2, count - 1, axis), slope(0, 1, axis), h0 + 2 * h1, 2 * h0 + h1);
            tangents[axis] = tangents[(count - 1) * width + axis] = tangent;
        }
    }
    return tangents;
}
