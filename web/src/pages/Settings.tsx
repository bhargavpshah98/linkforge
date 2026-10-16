import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/Layout";
import { useToast } from "../components/ui";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";

export function Settings() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { name?: string; password?: string }) => api<{ user: User }>("/auth/me", { method: "PATCH", json: body }),
    onSuccess: (r) => {
      qc.setQueryData(["me"], (old: object | undefined) => ({ ...old, user: r.user }));
      setPassword("");
      setError(null);
      toast("Saved");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-xl space-y-6">
        <form
          className="card space-y-4 p-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate({ name });
          }}
        >
          <h2 className="text-sm font-semibold">Profile</h2>
          <div>
            <label className="label" htmlFor="s-name">Name</label>
            <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <span className="label">Email</span>
            <p className="text-sm">{user?.email}</p>
            <p className="text-xs text-muted">Member since {user && fmtDate(user.created_at)}</p>
          </div>
          <button className="btn-primary" disabled={save.isPending}>Save profile</button>
        </form>
        <form
          className="card space-y-4 p-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate({ password });
          }}
        >
          <h2 className="text-sm font-semibold">Change password</h2>
          <input className="input" type="password" minLength={8} placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" aria-label="New password" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn-primary" disabled={save.isPending}>Update password</button>
        </form>
        <div className="card flex items-center justify-between p-5">
          <div>
            <h2 className="text-sm font-semibold">Log out</h2>
            <p className="text-xs text-muted">Ends this browser session.</p>
          </div>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    </>
  );
}
