import { useState, type FormEvent } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(name, email, password);
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <RouterLink to="/" className="mb-8 flex justify-center">
          <Logo className="text-lg" />
        </RouterLink>
        <div className="card p-6">
          <h1 className="text-xl font-semibold">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-1 text-sm text-ink-2">{mode === "login" ? "Log in to manage your links." : "Start shortening and tracking links in seconds."}</p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "register" && (
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "register" ? 8 : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
          {mode === "login" && (
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
              Ran <code className="font-mono">npm run seed</code>? Use <b>demo@linkforge.dev</b> / <b>demo12345</b>.
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-ink-2">
          {mode === "login" ? (
            <>No account? <RouterLink className="font-medium text-accent hover:underline" to="/register">Sign up free</RouterLink></>
          ) : (
            <>Already have an account? <RouterLink className="font-medium text-accent hover:underline" to="/login">Log in</RouterLink></>
          )}
        </p>
      </div>
    </div>
  );
}
