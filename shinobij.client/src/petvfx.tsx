// Keep the shipped Warfront QA surface physically separate from this page's
// legacy all-modes VFX workbench. Static imports here used to make `?rite=1`
// parse every Coliseum/Gauntlet/board renderer and hundreds of unrelated FX
// asset modules before its first frame.
const params = new URLSearchParams(window.location.search);

if (params.get("modelresources") === "1") {
    void import("./pet-model-lifecycle-preview");
} else if (params.get("rite") === "1" || params.get("warfront") === "1") {
    // Old shared Warfront preview links open the current game mode.
    void import("./petvfx-rite");
} else {
    void import("./petvfx-legacy");
}
