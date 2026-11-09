import { useState } from "react";
import { useApp } from "../state/app";
import { errorMessage, isBackendError } from "../lib/types";
import type { ConnectionOptions } from "../lib/connection";
import { connectionProblem, isEmptyConnection, mightNeedHeaders, normalizeConnection } from "../lib/connection";
import { ConnectionFields } from "./ConnectionFields";

export function SignIn() {
  const signIn = useApp((s) => s.signIn);
  // After "Sign in again" the server is known; only the key is new.
  const again = useApp((s) => s.signInServer);
  const [server, setServer] = useState(again);
  const [apiKey, setApiKey] = useState("");
  const againConnection = useApp((s) => s.signInConnection);
  const [connection, setConnection] = useState<ConnectionOptions>(againConnection);
  const [advanced, setAdvanced] = useState(() => !isEmptyConnection(againConnection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = connectionProblem(connection);
    if (problem) {
      setError({ message: problem, code: "invalid_header" });
      setAdvanced(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(server, apiKey, normalizeConnection(connection));
    } catch (err) {
      const code = isBackendError(err) ? err.code : undefined;
      setError({ message: errorMessage(err), code });
      if (code === "invalid_header") setAdvanced(true);
      setBusy(false);
    }
  }

  const offerHeaders = !!error && mightNeedHeaders(error.code) && !advanced;

  return (
    <main className="signin" data-tauri-drag-region>
      <form className="signin-card" onSubmit={submit} aria-labelledby="signin-title">
        <div className="signin-logo" aria-hidden>
          R
        </div>
        <h1 id="signin-title">Sign in to Redmine</h1>
        <p className="muted">
          {again
            ? "Redmine no longer accepts the API key Redline had. Paste the current one from My account in Redmine."
            : "Redline works with any Redmine server that has its REST API turned on."}
        </p>
        <label>
          <span>Server address</span>
          <input
            type="url"
            inputMode="url"
            autoFocus={!again}
            required
            placeholder="https://redmine.example.com"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label>
          <span>API key</span>
          <input
            type="password"
            required
            autoFocus={!!again}
            placeholder="From My account → API access key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="signin-advanced-toggle"
          aria-expanded={advanced}
          aria-controls="signin-advanced"
          onClick={() => setAdvanced((a) => !a)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="disclosure">
            <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Advanced
          {!advanced && !isEmptyConnection(connection) && <span className="muted"> (in use)</span>}
        </button>
        {advanced && (
          <div id="signin-advanced" className="signin-advanced">
            <p className="fine-print">Only for a server behind a proxy or gateway that needs more than the API key.</p>
            <ConnectionFields value={connection} onChange={setConnection} disabled={busy} />
          </div>
        )}
        {error && (
          <div className="signin-error" role="alert">
            <p>{error.message}</p>
            {offerHeaders && (
              <p>
                <button type="button" className="link-button" onClick={() => setAdvanced(true)}>
                  Add a username or headers
                </button>
              </p>
            )}
          </div>
        )}
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
        <p className="fine-print">Your key and headers are kept in the system keychain and sent only to this server.</p>
      </form>
    </main>
  );
}
