import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { api, getToken, setToken, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Origin short links are served from, e.g. https://lnk.example.com */
  shortDomain: string;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User; short_domain?: string }>("/auth/me"),
    enabled: Boolean(getToken()),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const finish = useCallback(
    (res: { token: string; user: User; short_domain?: string }) => {
      setToken(res.token);
      // Drop the previous account's cached data, but keep the "me" query alive so its observer re-renders.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.setQueryData(["me"], { user: res.user, short_domain: res.short_domain });
    },
    [qc],
  );

  const value: AuthState = {
    user: getToken() ? (me.data?.user ?? null) : null,
    loading: Boolean(getToken()) && me.isLoading,
    shortDomain: me.data?.short_domain ?? window.location.origin,
    login: async (email, password) => finish(await api("/auth/login", { method: "POST", json: { email, password } })),
    register: async (name, email, password) => finish(await api("/auth/register", { method: "POST", json: { name, email, password } })),
    logout: () => {
      setToken(null);
      qc.clear();
      window.location.assign("/login");
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
