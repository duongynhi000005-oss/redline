import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { CycleList } from "./components/CycleList";
import { InboxView } from "./components/InboxView";
import { IssueDetail } from "./components/IssueDetail";
import { IssueList } from "./components/IssueList";
import { NewIssue } from "./components/NewIssue";
import { Picker } from "./components/Picker";
import { FilterMenu } from "./components/Filters";
import { Settings } from "./components/Settings";
import { TimeDialog } from "./components/TimeDialog";
import { VersionDialog } from "./components/Cycle";
import { TimeView } from "./components/TimeView";
import { useIssueShortcuts } from "./components/useIssueShortcuts";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import type { Backend } from "./lib/backend";
import { getBackend, isTauri } from "./lib/backend";
import { platform } from "./lib/platform";
import { useApp } from "./state/app";

function Toast() {
  const toast = useApp((s) => s.toast);
  const showToast = useApp((s) => s.showToast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => showToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast, showToast]);
  // The live region stays in the page so screen readers announce each message.
  return (
    <div className="toast-region" role="status">
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function App({ backend }: { backend?: Backend }) {
  const phase = useApp((s) => s.phase);
  const openIssueId = useApp((s) => s.openIssueId);
  const route = useApp((s) => s.route);
  const start = useApp((s) => s.start);
  useIssueShortcuts();

  useEffect(() => {
    document.documentElement.dataset.platform = platform;
    if (isTauri()) document.documentElement.dataset.shell = "tauri";
    void (async () => {
      const b = backend ?? (await getBackend());
      // The window's native material shows through the sidebar when there is one.
      b.appInfo()
        .then((info) => (document.documentElement.dataset.material = info.material ?? "none"))
        .catch(() => {});
      await start(b);
    })();
  }, [backend, start]);

  if (phase === "starting") return <div className="app app-starting" data-tauri-drag-region />;
  if (phase === "signed-out") return <SignIn />;

  return (
    <div className="app" data-tauri-drag-region>
      <Sidebar />
      {openIssueId !== null ? (
        <IssueDetail id={openIssueId} />
      ) : route.view === "inbox" ? (
        <InboxView />
      ) : route.view === "cycles" ? (
        <CycleList teamId={route.teamId} />
      ) : route.view === "time" ? (
        <TimeView teamId={route.teamId} />
      ) : (
        <IssueList />
      )}
      <CommandPalette />
      <Picker />
      <FilterMenu />
      <NewIssue />
      <Settings />
      <TimeDialog />
      <VersionDialog />
      <Toast />
    </div>
  );
}
