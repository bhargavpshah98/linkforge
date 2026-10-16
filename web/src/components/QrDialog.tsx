import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { apiBlobUrl, download, type Link } from "../lib/api";
import { displayShort } from "../lib/format";
import { Modal, Spinner } from "./ui";

const COLORS = ["111827", "2a78d6", "1baf7a", "6250d6", "eb6834", "e34948"];

export function QrDialog({ link, onClose }: { link: Link | null; onClose: () => void }) {
  const [color, setColor] = useState(COLORS[0]);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    let url: string | null = null;
    let cancelled = false;
    setSrc(null);
    apiBlobUrl(`/links/${link.id}/qr?size=512&color=${color}`).then((u) => {
      url = u;
      if (!cancelled) setSrc(u);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [link, color]);

  return (
    <Modal open={Boolean(link)} onClose={onClose} title="QR code" width="max-w-sm">
      {link && (
        <div className="flex flex-col items-center">
          <div className="grid h-60 w-60 place-items-center rounded-xl border border-line bg-white p-2">
            {src ? <img src={src} alt={`QR code for ${link.short_url}`} className="h-full w-full" /> : <Spinner />}
          </div>
          <p className="mt-3 text-sm font-medium text-accent">{displayShort(link.short_url)}</p>
          <p className="text-xs text-muted">Scans are tracked separately from clicks.</p>
          <div className="mt-4 flex gap-2" role="radiogroup" aria-label="QR color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={`#${c}`}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${c === color ? "border-ink" : "border-transparent"}`}
                style={{ background: `#${c}` }}
              />
            ))}
          </div>
          <div className="mt-5 grid w-full grid-cols-2 gap-2">
            <button type="button" className="btn-primary" onClick={() => download(`/links/${link.id}/qr?size=1024&color=${color}&download=1`, `${link.code}-qr.png`)}>
              <Download size={15} /> PNG
            </button>
            <button type="button" className="btn-ghost" onClick={() => download(`/links/${link.id}/qr?format=svg&color=${color}&download=1`, `${link.code}-qr.svg`)}>
              <Download size={15} /> SVG
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
