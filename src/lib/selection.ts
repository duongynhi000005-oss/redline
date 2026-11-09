import { modHeld } from "./platform";

/**
 * What a click does to a multi-selection, as in Finder or Explorer:
 * Cmd/Ctrl+click adds or removes one issue, Shift+click adds every issue
 * from the anchor to the one clicked. Returns null for a plain click, which
 * opens the issue instead.
 */
export function clickSelection(
  order: number[],
  selection: number[],
  anchor: number | null,
  id: number,
  event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
): number[] | null {
  if (event.shiftKey) return [...new Set([...selection, ...rangeOf(order, anchor ?? id, id)])];
  if (modHeld(event)) return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
  return null;
}

/** The ids from one to the other, inclusive, in list order. */
export function rangeOf(order: number[], from: number, to: number): number[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
