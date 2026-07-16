"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.floorForSession = floorForSession;
const _floor_catalog_js_1 = require("./_floor-catalog.js");
/** Resolve the immutable rules sealed onto a dynamic PvE run, or a catalog floor. */
function floorForSession(session) {
    return session.encounterFloor ?? (0, _floor_catalog_js_1.getFloor)(session.floor);
}
