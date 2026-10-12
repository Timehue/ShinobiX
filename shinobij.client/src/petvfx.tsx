// Current development previews only. The retired continuous-duel workbench
// must never remount the old Fight Plan flow, even through a saved preview URL.
const params = new URLSearchParams(window.location.search);

if (params.get("modelresources") === "1") {
    void import("./pet-model-lifecycle-preview");
} else if (params.get("rite") === "1" || params.get("warfront") === "1") {
    // Old shared Warfront preview links open the current game mode.
    void import("./petvfx-rite");
} else {
    const notice = document.createElement('p');
    notice.textContent = 'This preview has been retired. Open Pet Arena in the game.';
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'Open game';
    document.getElementById('root')?.replaceChildren(notice, link);
}
