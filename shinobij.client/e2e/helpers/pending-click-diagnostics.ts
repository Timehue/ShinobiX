import type { Locator, TestInfo } from "@playwright/test";

type Scheduler = {
  now: () => number;
  after: (milliseconds: number, callback: () => void) => () => void;
};

const nodeScheduler: Scheduler = {
  now: () => performance.now(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

type DiagnosticEvent = {
  event: string;
  elapsedMs: number;
  pageClosed: boolean;
  settled: { elapsedMs: number; outcome: "resolved" | "rejected"; phase: string } | null;
  detail?: unknown;
};

type CaptureResult =
  | { status: "captured"; value: unknown }
  | { status: "node-deadline" }
  | { status: "error"; message: string };

// Each background promise gets a rejection handler immediately, including a
// late rejection after a Node deadline. Nothing diagnostic joins the click.
function bestEffort(work: () => unknown) {
  try {
    void Promise.resolve(work()).catch(() => {});
  } catch { /* Diagnostics must not replace the action's result. */ }
}

function boundedCapture(capture: () => Promise<unknown>, scheduler: Scheduler): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const cancel = scheduler.after(1_000, () => resolve({ status: "node-deadline" }));
    const finish = (result: CaptureResult) => {
      bestEffort(cancel);
      resolve(result);
    };
    try {
      void Promise.resolve(capture()).then(
        (value) => finish({ status: "captured", value }),
        (error: unknown) => finish({ status: "error", message: String(error).slice(0, 500) }),
      ).catch(() => finish({ status: "error", message: "Diagnostic result could not be read." }));
    } catch {
      finish({ status: "error", message: "Diagnostic capture could not start." });
    }
  });
}

/** Test-only orchestration. The original action starts once, before any timer.
 * There is no polling, retry, altered click option or added action timeout.
 */
export function runWithPendingClickDiagnostics<T>(options: {
  action: () => Promise<T>;
  isClosed: () => boolean;
  emit: (event: DiagnosticEvent) => unknown;
  snapshot: () => Promise<unknown>;
  probe: () => Promise<unknown>;
  scheduler?: Scheduler;
}): Promise<T> {
  const action = options.action(); // Synchronous throws also retain their identity.
  const scheduler = options.scheduler ?? nodeScheduler;
  const startedAt = scheduler.now();
  let pending = true;
  let triggered = false;
  let phase = "waiting";
  let settled: DiagnosticEvent["settled"] = null;
  let cancelTrigger = () => {};
  const emit = (event: string, detail?: unknown) => bestEffort(() => options.emit({
    event, elapsedMs: scheduler.now() - startedAt, pageClosed: options.isClosed(), settled, detail,
  }));
  const canCapture = () => pending && !options.isClosed();
  const capture = async () => {
    // This event is entirely Node-side; a frozen browser still leaves evidence.
    emit("pending");
    if (!canCapture()) { phase = "done"; return; }
    phase = "snapshot";
    const snapshot = await boundedCapture(options.snapshot, scheduler);
    emit("snapshot", snapshot); // Save before attempting any rAF evaluation.
    phase = "done";
    if (snapshot.status !== "captured" || !canCapture()) return;
    phase = "probe";
    emit("probe-start");
    if (!canCapture()) { phase = "done"; return; }
    const probe = await boundedCapture(options.probe, scheduler);
    emit("probe", probe);
    phase = "done";
  };
  const finish = (outcome: "resolved" | "rejected") => {
    pending = false;
    bestEffort(cancelTrigger);
    bestEffort(() => {
      settled = { elapsedMs: scheduler.now() - startedAt, outcome, phase };
      if (triggered) emit("settled");
    });
  };
  const result = action.then(
    (value) => { finish("resolved"); return value; },
    (error: unknown) => { finish("rejected"); throw error; },
  );
  bestEffort(() => {
    cancelTrigger = scheduler.after(5_000, () => {
      if (!pending || triggered) return;
      triggered = true;
      bestEffort(capture);
    });
  });
  return result;
}

export function clickWithPendingDiagnostics(
  locator: Locator,
  testInfo: TestInfo,
  context: { stage: string; locatorDescription: string; moves: readonly string[] },
): Promise<void> {
  // All other browser projects keep the direct, ordinary click path.
  if (testInfo.project.use.browserName !== "webkit") return locator.click();
  const page = locator.page();
  return runWithPendingClickDiagnostics({
    action: () => locator.click(),
    isClosed: () => page.isClosed(),
    emit: (event) => {
      const body = JSON.stringify({
        stage: context.stage,
        locator: context.locatorDescription,
        project: testInfo.project.name,
        viewport: page.viewportSize(),
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        parallelIndex: testInfo.parallelIndex,
        moves: context.moves.slice(-20),
        ...event,
      });
      // Log first: attachment writes themselves may stall during teardown.
      console.info(`[pending-click] ${body}`);
      return testInfo.attach(`pending-click-${context.stage}-${event.event}`, {
        body: Buffer.from(body), contentType: "application/json",
      });
    },
    snapshot: () => locator.evaluateAll((elements) => {
      // Object methods serialize without tsx's outer-scope __name helper.
      const helpers = {
        identify(element: Element) {
          return { tag: element.tagName, id: element.id.slice(0, 120),
            classes: element.getAttribute("class")?.slice(0, 200) ?? null,
            role: element.getAttribute("role")?.slice(0, 80) ?? null };
        },
        describe(element: Element) {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            ...helpers.identify(element),
            connected: element.isConnected,
            disabled: element.matches(":disabled"),
            ariaDisabled: element.getAttribute("aria-disabled")?.slice(0, 80) ?? null,
            ariaHidden: element.getAttribute("aria-hidden")?.slice(0, 80) ?? null,
            inert: element.hasAttribute("inert"),
            inertAncestor: Boolean(element.closest("[inert]")),
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
            style: {
              display: style.display, visibility: style.visibility, opacity: style.opacity,
              position: style.position, pointerEvents: style.pointerEvents,
              overflowX: style.overflowX, overflowY: style.overflowY,
              transform: style.transform.slice(0, 200), contain: style.contain,
              transformStyle: style.transformStyle, perspective: style.perspective,
              backfaceVisibility: style.backfaceVisibility, willChange: style.willChange.slice(0, 200),
              contentVisibility: style.contentVisibility,
              animationName: style.animationName.slice(0, 200),
              animationPlayState: style.animationPlayState.slice(0, 200), transitionProperty: style.transitionProperty.slice(0, 200),
            },
          };
        },
      };
      return {
        matchCount: elements.length,
        matchState: elements.length === 0 ? "zero" : elements.length === 1 ? "one" : "multiple",
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        activeElement: document.activeElement ? helpers.identify(document.activeElement) : null,
        readyState: document.readyState,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        visualViewport: window.visualViewport ? {
          width: window.visualViewport.width, height: window.visualViewport.height,
          scale: window.visualViewport.scale, offsetLeft: window.visualViewport.offsetLeft,
          offsetTop: window.visualViewport.offsetTop, pageLeft: window.visualViewport.pageLeft,
          pageTop: window.visualViewport.pageTop,
        } : null,
        targets: elements.slice(0, 2).map((element) => {
          const rect = element.getBoundingClientRect();
          const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          const hit = document.elementFromPoint(center.x, center.y);
          const ancestors = [];
          let parent = element.parentElement;
          for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
            ancestors.push(helpers.describe(parent));
          }
          return { target: helpers.describe(element), ancestors,
            centerHit: { ...center, element: hit ? helpers.identify(hit) : null,
              targetOrDescendant: hit ? element === hit || element.contains(hit) : false } };
        }),
        chronicle: [".chronicle-shell--duel-active", ".chronicle-playmat", ".chronicle-command-dock"].map((selector) => {
          const element = document.querySelector(selector);
          return { selector, present: Boolean(element), element: element ? helpers.describe(element) : null };
        }),
      };
    }),
    // This samples the main world only. It cannot establish that Playwright's
    // captured utility-world rAF (used for actionability) has resumed.
    probe: () => page.evaluate(() => new Promise((resolve) => {
      const startedAt = performance.now();
      const frames: number[] = [];
      let timerElapsedMs: number | null = null;
      let frameId = 0;
      let finished = false;
      const callbacks = {
        finish(completedBy: string) {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          clearTimeout(timer);
          cancelAnimationFrame(frameId);
          resolve({ completedBy, elapsedMs: performance.now() - startedAt, timerElapsedMs, frames,
            world: "main", utilityWorldRafProven: false });
        },
        maybeFinish() {
          if (frames.length === 2 && timerElapsedMs !== null) callbacks.finish("frames-and-timer");
        },
        frame() {
          if (finished) return;
          frames.push(performance.now() - startedAt);
          if (frames.length < 2) frameId = requestAnimationFrame(callbacks.frame);
          callbacks.maybeFinish();
        },
      };
      const deadline = setTimeout(() => callbacks.finish("browser-deadline"), 500);
      const timer = setTimeout(() => { timerElapsedMs = performance.now() - startedAt; callbacks.maybeFinish(); }, 0);
      frameId = requestAnimationFrame(callbacks.frame);
    })),
  });
}
