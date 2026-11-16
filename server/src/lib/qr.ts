import fs from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import { config } from "../config.js";

export interface QrOptions {
  format: "png" | "svg";
  /** Width and height in pixels. */
  size: number;
  /** Hex colors without "#". */
  color: string;
  bg: string;
  /** Draw the brand logo in the middle (only when a logo file is configured). */
  logo: boolean;
}

// The logo covers ~22% of the width (~5% of the area). With error correction "H" a QR code survives
// ~30% damage, so it still scans reliably.
const LOGO_SCALE = 0.22;
// Badge raster size used inside SVGs; high enough to stay sharp when the SVG is scaled up.
const SVG_BADGE_PX = 512;

let logoFile: Promise<Buffer | null> | undefined;

/** Reads the configured logo once. Missing file = no logo, so QR codes keep working before a logo is supplied. */
export function loadLogo(): Promise<Buffer | null> {
  logoFile ??= fs.readFile(config.qrLogoPath).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") console.error(`QR logo at ${config.qrLogoPath} could not be read:`, err);
    return null;
  });
  return logoFile;
}

/** The logo centred on a square of the QR background color, with padding so it doesn't touch the modules. */
async function logoBadge(logo: Buffer, px: number, bg: string) {
  const inner = Math.max(1, Math.round(px * 0.8));
  const fitted = await sharp(logo).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: px, height: px, channels: 4, background: `#${bg}` } })
    .composite([{ input: fitted, gravity: "center" }])
    .png()
    .toBuffer();
}

export async function renderQr(text: string, o: QrOptions): Promise<Buffer | string> {
  const logo = o.logo ? await loadLogo() : null;
  const base = {
    margin: 2,
    width: o.size,
    color: { dark: `#${o.color}`, light: `#${o.bg}` },
    errorCorrectionLevel: logo ? ("H" as const) : ("M" as const),
  };

  if (o.format === "svg") {
    const svg = await QRCode.toString(text, { ...base, type: "svg" });
    if (!logo) return svg;
    // The SVG is drawn in module units (viewBox "0 0 N N"); place the badge in the same units.
    const n = Number(/viewBox="0 0 (\d+(?:\.\d+)?)/.exec(svg)?.[1]);
    if (!n) return svg;
    const s = n * LOGO_SCALE;
    const at = (n - s) / 2;
    const href = `data:image/png;base64,${(await logoBadge(logo, SVG_BADGE_PX, o.bg)).toString("base64")}`;
    return svg.replace("</svg>", `<image x="${at}" y="${at}" width="${s}" height="${s}" href="${href}"/></svg>`);
  }

  const png = await QRCode.toBuffer(text, base);
  if (!logo) return png;
  const { width = o.size } = await sharp(png).metadata();
  return sharp(png)
    .composite([{ input: await logoBadge(logo, Math.round(width * LOGO_SCALE), o.bg), gravity: "center" }])
    .png()
    .toBuffer();
}
