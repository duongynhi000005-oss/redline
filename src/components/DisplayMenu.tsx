import { useEffect, useId, useRef, useState } from "react";
import type { Grouping, Ordering, Zoom } from "../lib/views";
import { GROUPINGS, ORDERINGS, ZOOMS } from "../lib/views";
import type { Route } from "../state/app";
import { routeKey, useApp, viewFor } from "../state/app";
import { Icon } from "./icons";

/** Linear's Display menu: how the list is grouped and ordered. */
export function DisplayMenu({ route }: { route: Route }) {
  const key = routeKey(route);
  const view = useApp((s) => viewFor(s, key));
  const updateView = useApp((s) => s.updateView);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Close when clicking anywhere else, like a native popover.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus the first control on open.
  useEffect(() => {
    if (open) panelRef.current?.querySelector("select")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="display-menu">
      <button
        ref={buttonRef}
        type="button"
        className="header-button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="display" />
        <span>Display</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Display options"
          className="display-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {view.layout !== "calendar" && (
            <label className="display-row">
              <span>{view.layout === "board" ? "Columns" : "Grouping"}</span>
              <select
                value={view.layout === "board" && view.grouping === "none" ? "status" : view.grouping}
                onChange={(e) => updateView(key, { grouping: e.target.value as Grouping })}
              >
                {GROUPINGS.filter((g) => view.layout !== "board" || g.value !== "none").map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="display-row">
            <span>Ordering</span>
            <select value={view.ordering} onChange={(e) => updateView(key, { ordering: e.target.value as Ordering })}>
              {ORDERINGS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {view.layout === "timeline" && (
            <label className="display-row">
              <span>Zoom</span>
              <select value={view.zoom} onChange={(e) => updateView(key, { zoom: e.target.value as Zoom })}>
                {ZOOMS.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view.layout === "board" && (
            <label className="display-row">
              <span>Show empty columns</span>
              <input
                type="checkbox"
                checked={view.showEmptyColumns}
                onChange={(e) => updateView(key, { showEmptyColumns: e.target.checked })}
              />
            </label>
          )}
          <p className="display-note">Saved for this list on this server.</p>
        </div>
      )}
    </div>
  );
}
