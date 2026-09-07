import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./academy-story-moments.css", import.meta.url), "utf8");

test("the Field Seal ceremony scrolls on a phone instead of clipping its Accept button", () => {
    // .asm-root is overflow:hidden. The mobile ceremony card had a min-height of
    // the viewport but no max-height, so once its copy plus the seal art
    // outgrew the screen the card simply grew past the root and was clipped —
    // and because the card was never constrained, its overflow:auto never
    // engaged. Measured at 412x838 with default fonts: card 864px, "Accept the
    // Field Seal" ending 9px below the viewport, nothing scrollable — and both
    // that button and "Skip Academy" sit below the fold, on the tutorial's last
    // step. Android text scaling makes it worse. The max-height (border-box, so
    // the padding no longer pushes the card past the screen either) makes the
    // card fit or scroll; the seal's min-height stops the grid from silently
    // collapsing the art to zero to make room.
    const mobile = css.slice(css.indexOf("@media(max-width:760px)"));
    const ceremony = mobile.match(/\.asm-ceremony\{([^}]*)\}/);
    assert.ok(ceremony, "the mobile ceremony rule exists");
    for (const declaration of [
        "min-height:calc(100% - 24px)",
        "max-height:calc(100% - 24px)",
        "box-sizing:border-box",
        "overflow:auto",
    ]) {
        assert.ok(ceremony[1].includes(declaration), `mobile .asm-ceremony keeps ${declaration}`);
    }
    const seal = mobile.match(/\.asm-seal\{([^}]*)\}/);
    assert.ok(seal, "the mobile seal rule exists");
    assert.ok(
        seal[1].includes("min-height:min(56vw,240px,31vh)"),
        "the seal art keeps its size instead of being squeezed out of the constrained card",
    );
});
