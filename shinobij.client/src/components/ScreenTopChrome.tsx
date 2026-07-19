import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { shouldShowScreenContextHeader } from "../lib/screen-context";
import { STUDIO_SCREEN_PRESENTATION } from "../lib/studio-screen-presentation";
import { MobileStatusHUD } from "./MobileStatusHUD";
import { ScreenContextHeader } from "./ScreenContextHeader";

export function ScreenTopChrome({
  character,
  onBack,
  screen,
}: {
  character: Character;
  onBack?: () => void;
  screen: Screen;
}) {
  const presentation = STUDIO_SCREEN_PRESENTATION[screen];
  const showContext = Boolean(presentation.facility) || shouldShowScreenContextHeader(screen);

  return (
    <>
      <MobileStatusHUD character={character} onBack={onBack} />
      {showContext && (
        <div className="screen-context-shell">
          <ScreenContextHeader screen={screen} village={character.village} />
        </div>
      )}
    </>
  );
}
