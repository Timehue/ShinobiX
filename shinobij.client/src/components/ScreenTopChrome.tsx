import type { Character } from "../types/character";
import { MobileStatusHUD } from "./MobileStatusHUD";

// The mobile-only status HUD (HP/chakra/stamina + back control). The shared
// "screen context" banner that used to render here was removed: it duplicated
// each page's own heading and added little navigation value.
export function ScreenTopChrome({
  character,
  onBack,
}: {
  character: Character;
  onBack?: () => void;
}) {
  return <MobileStatusHUD character={character} onBack={onBack} />;
}
