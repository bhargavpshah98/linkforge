import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { PageLoader, ToastProvider } from "./components/ui";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { AuthPage } from "./pages/Auth";
import { Developers } from "./pages/Developers";
import { Landing } from "./pages/Landing";
import { LinkDetail } from "./pages/LinkDetail";
import { Links } from "./pages/Links";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 10_000, retry: 1 } },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<Overview />} />
                <Route path="links" element={<Links />} />
                <Route path="links/:id" element={<LinkDetail />} />
                <Route path="developers" element={<Developers />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
