"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_role_js_1 = require("./_war-role.js");
(0, node_test_1.describe)('war-role: weights mirror the village-war model', () => {
    (0, node_test_1.it)('Kage 30/50, Elder 20/20, ANBU 15/0, villager 5/0; a merc is a villager', () => {
        node_assert_1.strict.deepEqual(_war_role_js_1.ROLE_KAGE, { win: 30, loss: 50 });
        node_assert_1.strict.deepEqual(_war_role_js_1.ROLE_ELDER, { win: 20, loss: 20 });
        node_assert_1.strict.deepEqual(_war_role_js_1.ROLE_ANBU, { win: 15, loss: 0 });
        node_assert_1.strict.deepEqual(_war_role_js_1.ROLE_VILLAGER, { win: 5, loss: 0 });
        node_assert_1.strict.deepEqual(_war_role_js_1.ROLE_MERC, _war_role_js_1.ROLE_VILLAGER);
    });
});
(0, node_test_1.describe)('war-role: sectorControlSwing = winner.win + loser.loss', () => {
    (0, node_test_1.it)('villager v villager = 5 (the small chip that makes a capture take a while)', () => {
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_VILLAGER, _war_role_js_1.ROLE_VILLAGER), 5);
    });
    (0, node_test_1.it)('a villager who fells a defending Kage swings 55 (5 + 50)', () => {
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_VILLAGER, _war_role_js_1.ROLE_KAGE), 55);
    });
    (0, node_test_1.it)('a Kage storming a villager swings 30 (30 + 0)', () => {
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_KAGE, _war_role_js_1.ROLE_VILLAGER), 30);
    });
    (0, node_test_1.it)('Kage v Kage = 80 (30 + 50)', () => {
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_KAGE, _war_role_js_1.ROLE_KAGE), 80);
    });
    (0, node_test_1.it)('applies the War-Academy multiplier and never drops below 1', () => {
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_VILLAGER, _war_role_js_1.ROLE_VILLAGER, 1.15), 6); // round(5 * 1.15)
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_KAGE, _war_role_js_1.ROLE_KAGE, 1.15), 92); // round(80 * 1.15)
        node_assert_1.strict.equal((0, _war_role_js_1.sectorControlSwing)(_war_role_js_1.ROLE_VILLAGER, _war_role_js_1.ROLE_VILLAGER, 0), 1); // floored to >= 1
    });
});
