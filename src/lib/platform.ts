// Platform conventions: Cmd on macOS, Ctrl on Windows.

export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(): Platform {
  const ua = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  if (/Mac|iPhone|iPad/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  return "linux";
}

export const platform: Platform = detectPlatform();
export const isMac = platform === "macos";

/** The label for the main modifier key. */
export const modLabel = isMac ? "⌘" : "Ctrl";

/**
 * Human-readable shortcut, in the platform's own style:
 * "mod+k" is "⌘K" on macOS and "Ctrl+K" on Windows.
 */
export function shortcutLabel(shortcut: string): string {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase());
  const names: Record<string, [mac: string, other: string]> = {
    mod: ["⌘", "Ctrl"],
    shift: ["⇧", "Shift"],
    alt: ["⌥", "Alt"],
    enter: ["↩", "Enter"],
    escape: ["Esc", "Esc"],
    backspace: ["⌫", "Backspace"],
    arrowup: ["↑", "Up"],
    arrowdown: ["↓", "Down"],
  };
  const labels = parts.map((p) => {
    const n = names[p];
    if (n) return isMac ? n[0] : n[1];
    return p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1);
  });
  return isMac ? labels.join("") : labels.join("+");
}

/** Whether the platform's main modifier (Cmd on macOS, Ctrl elsewhere) is held. */
export function modHeld(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** Whether a keyboard event matches a shortcut like "mod+k" or "shift+c". */
export function matchesShortcut(event: KeyboardEvent | React.KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1]!;
  const want = new Set(parts.slice(0, -1));
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (want.has("mod") !== mod) return false;
  if (want.has("shift") !== event.shiftKey) return false;
  if (want.has("alt") !== event.altKey) return false;
  // The other of Cmd/Ctrl must not be held.
  if (!want.has("mod") && (event.metaKey || event.ctrlKey)) return false;
  if (isMac && event.ctrlKey && want.has("mod")) return false;
  return event.key.toLowerCase() === key;
}

/** True when focus is in a text field, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
