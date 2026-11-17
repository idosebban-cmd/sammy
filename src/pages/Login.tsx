import { useState } from "react";
import { ErrorNote, Spinner } from "../components/ui";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "reset">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "password") {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) setError(err.message === "Invalid login credentials" ? "That email and password don't match." : err.message);
    } else {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/settings?reset=1` });
      if (err) setError(err.message);
      else setNotice("If that address belongs to an account, a reset link is on its way.");
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-3xl font-semibold">Sammy</h1>
          <p className="mt-1 text-sm text-stone-500">A private space for Ido and Helen</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <ErrorNote message={error} />}
          {notice && <p className="rounded-xl bg-sage-50 p-3 text-sm text-sage-800">{notice}</p>}
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === "password" && (
            <label className="block">
              <span className="label">Password</span>
              <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          <button className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />}
            {mode === "password" ? "Sign in" : "Send reset link"}
          </button>
          <button type="button" className="w-full text-center text-xs text-stone-500 underline" onClick={() => setMode(mode === "password" ? "reset" : "password")}>
            {mode === "password" ? "Forgotten your password?" : "Back to sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-stone-400">Accounts are created by invitation only.</p>
      </div>
    </div>
  );
}
