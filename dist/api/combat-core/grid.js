"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xy = xy;
exports.posFromXY = posFromXY;
exports.axial = axial;
exports.hexDistance = hexDistance;
exports.hexNeighbors = hexNeighbors;
exports.nextStepToward = nextStepToward;
const constants_js_1 = require("./constants.js");
function xy(pos, width = constants_js_1.GRID_W) {
    return { x: pos % width, y: Math.floor(pos / width) };
}
function posFromXY(x, y, width = constants_js_1.GRID_W, height = constants_js_1.GRID_H) {
    if (x < 0 || x >= width || y < 0 || y >= height)
        return -1;
    return y * width + x;
}
function axial(pos, width = constants_js_1.GRID_W) {
    const { x, y } = xy(pos, width);
    return { q: x, r: y - ((x - (x & 1)) / 2) };
}
function hexDistance(a, b, width = constants_js_1.GRID_W) {
    const A = axial(a, width);
    const B = axial(b, width);
    return (Math.abs(A.q - B.q) + Math.abs(A.q + A.r - B.q - B.r) + Math.abs(A.r - B.r)) / 2;
}
function hexNeighbors(pos, width = constants_js_1.GRID_W, height = constants_js_1.GRID_H) {
    const { x, y } = xy(pos, width);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx, y + dy, width, height)).filter(n => n >= 0);
}
function nextStepToward(from, to, width = constants_js_1.GRID_W, height = constants_js_1.GRID_H) {
    return hexNeighbors(from, width, height).sort((a, b) => hexDistance(a, to, width) - hexDistance(b, to, width))[0] ?? from;
}
