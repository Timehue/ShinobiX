'use strict';
const { createHmac, randomBytes } = require('node:crypto');
const MAX_INPUT = 1024 * 1024;
const METHODS = new Set([
  'Playwright.enable', 'Playwright.createContext', 'Playwright.deleteContext', 'Playwright.createPage',
  'Playwright.pageProxyCreated', 'Playwright.pageProxyDestroyed', 'Playwright.provisionalLoadFailed',
  'Playwright.navigate', 'Page.createUserWorld', 'Target.activate',
  'Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.awaitPromise', 'Runtime.getProperties',
  'Runtime.releaseObject', 'Runtime.enable', 'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed', 'Runtime.executionContextsCleared',
  'Target.sendMessageToTarget', 'Target.dispatchMessageFromTarget', 'Target.targetCreated',
  'Target.targetDestroyed', 'Target.didCommitProvisionalTarget', 'Target.targetCrashed',
  'Browser.createContext', 'Browser.deleteContext', 'Browser.createPage', 'Browser.closePage',
  'Browser.pageProxyCreated', 'Browser.pageProxyDestroyed', 'Browser.provisionalLoadFailed',
  'Page.enable', 'Page.navigate', 'Page.frameNavigated', 'Page.frameDetached', 'Page.frameAttached',
  'Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.loadEventFired',
  'Page.domContentEventFired', 'Page.lifecycleEvent', 'Page.crash',
  'Page.dispatchMouseEvent', 'Page.dispatchTouchEvent', 'Input.dispatchMouseEvent',
  'Input.dispatchTouchEvent', 'Input.dispatchKeyEvent', 'DOM.resolveNode', 'DOM.describeNode',
]);
const TYPES = new Set(['object', 'function', 'undefined', 'string', 'number', 'boolean', 'symbol', 'bigint']);
const SUBTYPES = new Set(['array', 'null', 'node', 'error', 'promise', 'date', 'regexp']);
const SIGNALS = new Set(['null', 'SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGILL', 'SIGBUS', 'SIGTRAP']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = value => Number.isSafeInteger(value);

function createProjector() {
  // Key is never persisted; arbitrary engine IDs and code cannot leak as raw strings.
  const key = randomBytes(32);
  const stats = { input: 0, malformed: 0, oversized: 0, upstreamTruncated: 0,
    omittedFields: 0, unknownMethod: 0, browserOmitted: 0, invalidId: 0, nestedOmitted: 0 };
  function opaque(value) {
    if (!(typeof value === 'string' && value.length > 0 && value.length <= 4096) && !int(value)) {
      stats.invalidId++;
      return undefined;
    }
    return createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 24);
  }
  function ids(from, to) {
    if (!object(from)) return;
    for (const field of ['sessionId', 'pageProxyId', 'targetId', 'contextId', 'executionContextId', 'frameId', 'objectId', 'browserContextId']) {
      if (Object.hasOwn(from, field)) to[field] = opaque(from[field]);
    }
  }
  function codeRole(code) {
    if (typeof code !== 'string' || code.length > MAX_INPUT) return undefined;
    let role = 'other';
    if (code.includes('matchState') && code.includes('centerHit') && code.includes('utilityWorldRafProven') === false) role = 'pending-snapshot';
    else if (code.includes('utilityWorldRafProven') && code.includes('frames-and-timer')) role = 'pending-raf-probe';
    else if (code.includes('callMatchedElements') && code.includes('injected.querySelectorAll')) role = 'selector-dispatch';
    else if (code.includes('checkElementStates')) role = 'actionability';
    else if (code.includes('setupHitTargetInterceptor')) role = 'hit-target';
    else if (code.includes('InjectedScript') && code.length > 10000) role = 'injected-script';
    else if (code.includes('UtilityScript') && code.length > 1000) role = 'utility-script';
    return { role, fingerprint: createHmac('sha256', key).update(code).digest('hex').slice(0, 24) };
  }
  function project(message, depth = 0) {
    if (!object(message)) { stats.malformed++; return null; }
    stats.omittedFields += Object.keys(message).filter(k => !['id', 'method', 'sessionId', 'pageProxyId'].includes(k)).length;
    const out = {};
    if (Object.hasOwn(message, 'id')) {
      if (int(message.id)) out.id = message.id;
      else stats.invalidId++;
    }
    ids(message, out);
    if (typeof message.method === 'string') {
      out.method = METHODS.has(message.method) ? message.method : 'omitted';
      if (out.method === 'omitted') stats.unknownMethod++;
    } else if (Object.hasOwn(message, 'method')) { stats.malformed++; return null; }
    out.response = !Object.hasOwn(message, 'method') && Object.hasOwn(out, 'id');
    out.errorPresent = Object.hasOwn(message, 'error');
    const p = object(message.params) ? message.params : {};
    const r = object(message.result) ? message.result : {};
    // Only IDs, structural flags, and fixed enums from documented protocol positions.
    if (out.method !== 'omitted') {
      ids(p, out);
      for (const field of ['returnByValue', 'awaitPromise', 'emulateUserGesture']) {
        if (typeof p[field] === 'boolean') out[field] = p[field];
      }
      if (object(p.context)) {
        out.createdContext = opaque(p.context.id);
        if (p.context.type === 'normal') out.world = 'main';
        else if (p.context.type === 'user' && p.context.name === '__playwright_utility_world__') out.world = 'utility';
        ids(p.context, out);
      }
      if (object(p.targetInfo)) ids(p.targetInfo, out);
      if (object(p.frame)) out.frameId = opaque(p.frame.id);
    }
    if (out.response) {
      ids(r, out);
      out.resultPresent = Object.hasOwn(message, 'result');
      if (typeof r.wasThrown === 'boolean') out.wasThrown = r.wasThrown;
      if (object(r.result)) {
        ids(r.result, out);
        if (TYPES.has(r.result.type)) out.resultType = r.result.type;
        if (SUBTYPES.has(r.result.subtype)) out.resultSubtype = r.result.subtype;
      }
    }
    if (out.method === 'Runtime.evaluate') out.code = codeRole(p.expression);
    if (out.method === 'Runtime.callFunctionOn') {
      // Pinned 1.62.1 WKExecutionContext: args[0]=utility handle; values start at 1;
      // values[2] (args[3]) is the expression, not serialized caller/page arguments.
      out.code = codeRole(p.arguments?.[3]?.value) ?? codeRole(p.functionDeclaration);
      if (Array.isArray(p.arguments)) out.argumentCount = p.arguments.length;
      if (out.code?.role === 'selector-dispatch' && Array.isArray(p.arguments?.[6]?.value?.o)) {
        const fields = p.arguments[6].value.o;
        const functionText = fields.length <= 32 ? fields.find(field => field.k === 'functionText')?.v : undefined;
        if (typeof functionText === 'string' && functionText.length < 128 && /^\(\{\s*elements\s*\}\)\s*=>\s*elements$/.test(functionText.trim())) out.selectorArray = true;
      }
      out.objectId = p.objectId === undefined ? undefined : opaque(p.objectId);
    }
    if (out.method === 'Target.sendMessageToTarget' || out.method === 'Target.dispatchMessageFromTarget') {
      if (depth < 2 && typeof p.message === 'string' && p.message.length <= MAX_INPUT) {
        try { out.inner = project(JSON.parse(p.message), depth + 1); } catch { stats.malformed++; }
      } else stats.nestedOmitted++;
    }
    return out;
  }
  function input(name, message) {
    stats.input++;
    if (typeof message !== 'string') { stats.malformed++; return null; }
    if (message.length > MAX_INPUT || Buffer.byteLength(message) > MAX_INPUT) { stats.oversized++; return null; }
    if (message.includes(' <<<<<( LOG TRUNCATED )>>>>> ')) { stats.upstreamTruncated++; return null; }
    if (name === 'protocol') {
      const prefix = message.startsWith('SEND \u25ba ') ? 'SEND \u25ba ' : message.startsWith('\u25c0 RECV ') ? '\u25c0 RECV ' : null;
      if (!prefix) { stats.malformed++; return null; }
      try {
        const value = project(JSON.parse(message.slice(prefix.length)));
        return value ? { kind: 'protocol', direction: prefix.startsWith('SEND') ? 'send' : 'receive', ...value } : null;
      } catch { stats.malformed++; return null; }
    }
    if (name === 'browser') {
      let m = /^<launched> pid=(\d+)$/.exec(message);
      if (m && int(Number(m[1]))) return { kind: 'browser', event: 'launched', browserPid: Number(m[1]) };
      m = /^\[pid=(\d+)\] <process did exit: exitCode=(null|-?\d+), signal=([A-Z0-9]+|null)>$/.exec(message);
      if (m && int(Number(m[1])) && (m[2] === 'null' || int(Number(m[2]))) && SIGNALS.has(m[3])) return { kind: 'browser', event: 'exit', browserPid: Number(m[1]), exitCode: m[2] === 'null' ? null : Number(m[2]), signal: m[3] };
      m = /^\[pid=(\d+)\] <(gracefully close start|gracefully close end|kill|will force kill)>$/.exec(message);
      if (m && int(Number(m[1]))) return { kind: 'browser', event: m[2], browserPid: Number(m[1]) };
      // No launch command, stderr/stdout text, URLs, errors or arbitrary fallback.
      stats.browserOmitted++;
    }
    return null;
  }
  return { input, stats };
}
module.exports = { createProjector, MAX_INPUT };
