import { expect, test } from "@playwright/test";

/*
 * The PvP result card must not take the battle log and chat down with it.
 *
 * On 2026-09-01 the result card rendered inside the jutsu bar — a bottom-left
 * grid cell — which pinned it to a corner and pushed its exit buttons below the
 * fold. Moving it to a screen-centred layer fixed that, but a full-arena layer
 * brings its own hazard: `.arena-fullscreen .battle-ended-overlay` paints a
 * blurred 0.85 scrim with !important, which would leave the log and the chat
 * both unclickable AND unreadable the moment a duel ends. PvP is the core loop
 * and people talk after a fight, so the scrim is presentation only.
 *
 * Two things have to hold, and only one of them is obvious:
 *   - pointer-events must not be swallowed by the scrim, and
 *   - the scrim must not paint or blur over what is behind it — a scrim that is
 *     clickable but opaque is the same bug wearing a different hat.
 *
 * The override needs THREE classes to out-specify that !important rule, which
 * is exactly the kind of cascade reasoning that looks right in a diff and ships
 * wrong. So this resolves it in a real engine, against the real built
 * stylesheet, and hit-tests through the scrim rather than trusting computed
 * values alone. It runs on WebKit and Firefox too because backdrop-filter is
 * where those engines differ most.
 */

const CARD = ".battle-ended-card";
const STAGE = ".battle-ended-overlay--stage";

test.describe("PvP result scrim", () => {
    test("lets clicks and readability through to the log and chat", async ({ page }) => {
        await page.goto("/");
        const href = await page.evaluate(() => {
            const link = document.querySelector('link[rel="stylesheet"]');
            return link?.getAttribute("href") ?? null;
        });
        expect(href, "the built app must ship a stylesheet, or this contract proves nothing").toBeTruthy();

        await page.setContent(
            `<link rel="stylesheet" href="${href}">
             <style>html,body{margin:0;height:100%}</style>
             <div class="arena-fullscreen shinobi-combat-shell" style="position:relative;width:100%;height:100%">
               <div class="battle-ended-overlay battle-ended-overlay--stage">
                 <div class="card battle-ended-card">
                   <h2 class="battle-result-win">Victory</h2>
                   <div class="menu"><button id="exitbtn">Return to Village</button></div>
                 </div>
               </div>
             </div>
             <!-- Control: the same overlay WITHOUT the stage modifier still dims,
                  which is what every other fight screen relies on. If the modifier
                  ever stops applying, this is what tells the two cases apart. -->
             <div class="arena-fullscreen" style="position:absolute;left:-9999px;top:0;width:400px;height:300px">
               <div class="battle-ended-overlay" id="control"><div class="card battle-ended-card">x</div></div>
             </div>`,
            { waitUntil: "load" },
        );

        await expect(page.locator(STAGE)).toBeVisible();

        // Put the stand-in chat at a point the scrim genuinely covers but the
        // card does not, derived from the live card box so this holds on every
        // viewport in the matrix — from 360x640 up to 1366x768.
        const placed = await page.evaluate(({ cardSel, stageSel }) => {
            const card = document.querySelector(cardSel)!.getBoundingClientRect();
            const stage = document.querySelector(stageSel)!.getBoundingClientRect();
            const h = 36;
            const gap = 12;
            // Below the card if it fits inside the scrim, otherwise above it.
            let top = card.bottom + gap;
            if (top + h > stage.bottom) top = card.top - gap - h;
            const chat = document.createElement("input");
            chat.id = "chatinput";
            Object.assign(chat.style, {
                position: "fixed",
                left: "8px",
                top: `${Math.max(0, Math.round(top))}px`,
                width: "140px",
                height: `${h}px`,
                margin: "0",
            });
            document.body.appendChild(chat);
            const box = chat.getBoundingClientRect();
            const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            return {
                point,
                // Guards: the assertions below are worthless unless the scrim
                // really covers this point and the card really does not.
                scrimCoversPoint: point.x >= stage.left && point.x <= stage.right
                    && point.y >= stage.top && point.y <= stage.bottom,
                cardCoversPoint: point.x >= card.left && point.x <= card.right
                    && point.y >= card.top && point.y <= card.bottom,
            };
        }, { cardSel: CARD, stageSel: STAGE });

        expect(placed.scrimCoversPoint, "the scrim must actually cover the chat point").toBe(true);
        expect(placed.cardCoversPoint, "the chat point must sit outside the card").toBe(false);

        const probe = await page.evaluate(({ point, stageSel, cardSel }) => {
            const stage = document.querySelector(stageSel)!;
            const card = document.querySelector(cardSel)!;
            const control = document.getElementById("control")!;
            const s = getComputedStyle(stage) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
            const c = getComputedStyle(card);
            const ctrl = getComputedStyle(control);
            const cardBox = card.getBoundingClientRect();
            const hit = document.elementFromPoint(point.x, point.y);
            const cardHit = document.elementFromPoint(cardBox.left + cardBox.width / 2, cardBox.top + 8);
            return {
                stagePointerEvents: s.pointerEvents,
                stageBackground: s.backgroundColor,
                stageBackdrop: s.backdropFilter ?? s.webkitBackdropFilter ?? "none",
                stagePosition: s.position,
                cardPointerEvents: c.pointerEvents,
                controlBackground: ctrl.backgroundColor,
                hitId: hit?.id ?? "",
                cardHitIsCard: !!cardHit && (cardHit === card || card.contains(cardHit)),
            };
        }, { point: placed.point, stageSel: STAGE, cardSel: CARD });

        // Presentation only.
        expect(probe.stagePointerEvents).toBe("none");
        expect(probe.stageBackground).toBe("rgba(0, 0, 0, 0)");
        expect(probe.stageBackdrop === "none" || probe.stageBackdrop === "").toBeTruthy();
        // …but still a full-viewport layer, so the card stays centred on screen.
        expect(probe.stagePosition).toBe("fixed");

        // The card itself is the one thing that DOES take input.
        expect(probe.cardPointerEvents).toBe("auto");
        expect(probe.cardHitIsCard, "the result card must still be clickable").toBe(true);

        // The actual point of all this: a click where the chat lives reaches the chat.
        expect(probe.hitId, "a click over the chat must reach the chat, not the scrim").toBe("chatinput");

        // And the plain overlay other fight screens use still dims, so a
        // regression that drops the modifier is distinguishable from one that
        // removes the scrim everywhere.
        expect(probe.controlBackground).not.toBe("rgba(0, 0, 0, 0)");
    });
});
