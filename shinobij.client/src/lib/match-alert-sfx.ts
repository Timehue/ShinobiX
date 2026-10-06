import { useEffect, useRef } from "react";
import { getAudioVolume, isAudioMuted } from "./pet-music";

/*
 * The PvP notification: a ranked queue found a match, or someone challenged or
 * attacked you. It obeys the master mute and volume.
 *
 * Unlike the game cues it also plays in a hidden tab, because a player who
 * tabbed out while waiting is exactly who needs it. The game bus is parked
 * while hidden, so this sound always plays on its own <audio> element. It is an
 * MP3, which every browser decodes, so it needs no .ogg/.m4a delivery siblings.
 * 0.2 sits slightly above the game cues (the file is ~3 dB hotter than
 * battle-transition, which plays at 0.24 x 0.92 master).
 */
export function playFightNotificationSfx(): void {
  if (isAudioMuted()) return;
  const audio = new Audio("/sfx/production/fight-notification.mp3");
  audio.volume = 0.2 * getAudioVolume();
  void audio.play().catch(() => {});
}

/**
 * Plays the notification when `found` turns true after this panel saw the
 * player searching, so a match restored on mount or after navigation stays quiet.
 * `searching` should include the in-flight join, since a join can pair at once.
 */
export function useMatchFoundSfx(found: boolean, searching: boolean): void {
  const armed = useRef(false);
  useEffect(() => {
    const [play, next] = matchFoundStep(armed.current, found, searching);
    armed.current = next;
    if (play) playFightNotificationSfx();
  }, [found, searching]);
}

/** One step of the rule above: [play now, armed afterwards]. */
export const matchFoundStep = (armed: boolean, found: boolean, searching: boolean): [boolean, boolean] =>
  [found && armed, !found && searching];
