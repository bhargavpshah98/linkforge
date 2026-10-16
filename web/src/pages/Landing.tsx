import { BarChart3, Code2, Lock, QrCode, Smartphone, Webhook } from "lucide-react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { useAuth } from "../lib/auth";

const FEATURES = [
  { icon: BarChart3, title: "Real-time analytics", body: "Clicks, unique visitors, referrers, countries, cities, devices, browsers and a weekday × hour heatmap. Click any bar to drill down." },
  { icon: QrCode, title: "QR codes", body: "Every link gets a colorable PNG/SVG QR code. Scans are tracked separately from clicks." },
  { icon: Lock, title: "Link controls", body: "Custom back-halves, password protection, expiry dates, click limits and 301/302 redirects." },
  { icon: Smartphone, title: "Device targeting", body: "Send iPhone and Android visitors to their app store, everyone else to the web." },
  { icon: Code2, title: "Developer API", body: "A documented REST API with API keys, bulk creation and an OpenAPI spec. Drop the TypeScript SDK into any repo." },
  { icon: Webhook, title: "Webhooks", body: "Get a signed POST to your server on every click, create, update or delete." },
];

export function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to="/app" replace />;
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo className="text-lg" />
        <nav className="flex items-center gap-2">
          <a className="btn hidden text-ink-2 hover:text-ink sm:inline-flex" href="/api/docs">API docs</a>
          <RouterLink className="btn-ghost" to="/login">Log in</RouterLink>
          <RouterLink className="btn-primary" to="/register">Sign up free</RouterLink>
        </nav>
      </header>
      <section className="mx-auto max-w-3xl px-4 pb-16 pt-16 text-center sm:pt-24">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Short links with analytics you'll actually use</h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-ink-2">
          LinkForge turns long URLs into short, branded links and QR codes, then shows you exactly who clicked, from where, and when.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <RouterLink className="btn-primary px-5 py-2.5 text-base" to="/register">Get started — it's free</RouterLink>
          <a className="btn-ghost px-5 py-2.5 text-base" href="/api/docs">Explore the API</a>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-6">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon size={20} />
            </div>
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm text-ink-2">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
