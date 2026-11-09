import { redminePathOf } from "../lib/redmineLinks";
import { shortcutLabel } from "../lib/platform";
import { useApp } from "../state/app";
import { Icon } from "./icons";

/** Opens the page in Redmine that shows what the current view shows. */
export function openViewInRedmine() {
  const state = useApp.getState();
  const path = redminePathOf(state.route, state.meta);
  if (path) state.openInRedmine(path);
}

/** The header button that opens the current view in Redmine (Mod+Shift+O). */
export function OpenInRedmineButton() {
  const label = `Open in Redmine (${shortcutLabel("mod+shift+o")})`;
  return (
    <button type="button" className="icon-button" onClick={openViewInRedmine} aria-label="Open in Redmine" title={label}>
      <Icon name="external" />
    </button>
  );
}
