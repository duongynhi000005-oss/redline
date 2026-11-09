import { useState } from "react";
import { useApp } from "../state/app";
import { errorMessage } from "../lib/types";

export function SignIn() {
  const signIn = useApp((s) => s.signIn);
  // After "Sign in again" the server is known; only the key is new.
  const again = useApp((s) => s.signInServer);
  const [server, setServer] = useState(again);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(server, apiKey);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

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
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
        <p className="fine-print">Your key is kept in the system keychain and sent only to this server.</p>
      </form>
    </main>
  );
}
