import { Check, Copy, Globe, Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { faviconUrl } from "../lib/format";

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: "default" | "error" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${t.tone === "error" ? "bg-bad text-white" : "bg-ink text-page"}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Modal ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card max-h-[92vh] w-full ${width} overflow-y-auto rounded-b-none shadow-2xl sm:rounded-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Small pieces ----------

export function CopyButton({ text, label, className = "btn-ghost" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            toast("Copied to clipboard");
            setTimeout(() => setDone(false), 1500);
          },
          () => toast("Couldn't access the clipboard", "error"),
        );
      }}
      aria-label={label ?? "Copy"}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

export function Favicon({ url, size = 32 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-line bg-surface" style={{ width: size, height: size }}>
      {failed ? (
        <Globe size={size * 0.5} className="text-muted" />
      ) : (
        <img src={faviconUrl(url)} alt="" width={size * 0.5} height={size * 0.5} onError={() => setFailed(true)} loading="lazy" />
      )}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-muted ${className}`} size={20} />;
}

export function PageLoader() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-accent" : "bg-grid"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}
