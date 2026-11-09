import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { CycleList } from "./components/CycleList";
import { IssueDetail } from "./components/IssueDetail";
import { IssueList } from "./components/IssueList";
import { NewIssue } from "./components/NewIssue";
import { Picker } from "./components/Picker";
import { Settings } from "./components/Settings";
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
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast}
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
    void (async () => start(backend ?? (await getBackend())))();
  }, [backend, start]);

  if (phase === "starting") return <div className="app app-starting" data-tauri-drag-region />;
  if (phase === "signed-out") return <SignIn />;

  return (
    <div className="app">
      <Sidebar />
      {openIssueId !== null ? (
        <IssueDetail id={openIssueId} />
      ) : route.view === "cycles" ? (
        <CycleList teamId={route.teamId} />
      ) : (
        <IssueList />
      )}
      <CommandPalette />
      <Picker />
      <NewIssue />
      <Settings />
      <Toast />
    </div>
  );
}
