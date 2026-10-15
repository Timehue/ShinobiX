import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WeeklyBossResult} from './WeeklyBossResult';
function render(state:'pending'|'failed'|'settled', receipt:unknown=null){
    return renderToStaticMarkup(createElement(WeeklyBossResult,{won:false,settleState:state,settleResult:receipt,onRetry(){},onExit(){},exitLabel:'Return to World Map'}));
}
test('an unconfirmed weekly result offers retry and does not present the normal return as ready',()=>{
    assert.match(render('pending'),/<button[^>]*disabled=""[^>]*>Return to World Map/);
    const failed=render('failed');
    assert.match(failed,/Retry settlement/);assert.match(failed,/Leave without confirmation/);
    assert.match(failed,/<button[^>]*disabled=""[^>]*>Return to World Map/);
    assert.doesNotMatch(failed,/Assault Logged/);
});
test('a Broken boss result distinguishes leaderboard damage from depleted shared health',()=>{
    const paid=render('settled',{dealt:17127,boss:{hpRemaining:0,broken:true}});
    assert.match(paid,/17,127/);assert.match(paid,/Weekly Boss is Broken/);
    assert.match(paid,/stays available/);assert.match(paid,/0 HP/);
    assert.doesNotMatch(paid,/disabled=""|taken off/);
});
