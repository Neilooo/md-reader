import { readFile } from "@tauri-apps/plugin-fs";

const TAURI_ASSET_PATTERNS = [
  /^https?:\/\/asset\.localhost\//i,
  /^asset:\/\/localhost\//i,
  /^https?:\/\/[^/]+\.localhost\/+/i,
];

function isExternal(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:)/i.test(src);
}

function decodeTauriAsset(src: string): string | null {
  for (const re of TAURI_ASSET_PATTERNS) {
    if (re.test(src)) {
      const rest = src.replace(re, "");
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    }
  }
  return null;
}

function extFromPath(p: string): string {
  const m = p.match(/\.([A-Za-z0-9]+)(?:\?|#|$)/);
  return m ? m[1].toLowerCase() : "";
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    default: return "application/octet-stream";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(bin);
}

function isPrivateUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Named hosts that resolve to or serve loopback / link-local traffic.
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  // IPv4 literals — normalize by stripping any leading zeros so that
  // "0177.0.0.1" / "127.00.0.1" can't sneak past a string match.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const oct = (s: string) => parseInt(s, 10);
    if (v4.slice(1).some((s) => oct(s) > 255)) return true;
    const first = oct(v4[1]);
    // Reject decimal/octal-ambiguous forms by also checking the raw octets.
    if (first === 0 || first === 127) return true; // 0.x and 127.x (loopback)
    if (first === 10) return true; // 10.0.0.0/8
    if (first === 192 && oct(v4[2]) === 168) return true; // 192.168.0.0/16
    if (first === 172 && oct(v4[2]) >= 16 && oct(v4[2]) <= 31) return true; // 172.16.0.0/12
    if (first === 169 && oct(v4[2]) === 254) return true; // 169.254.0.0/16 (link-local)
    if (first === 100 && oct(v4[2]) >= 64 && oct(v4[2]) <= 127) return true; // 100.64.0.0/10 (CGNAT)
    return false;
  }

  // IPv6 literals.
  if (host.includes(":")) {
    if (
      host === "::" ||
      host === "::1" ||
      host === "0:0:0:0:0:0:0:0" ||
      host === "0:0:0:0:0:0:0:1" ||
      host.startsWith("fe80:") || // link-local
      host.startsWith("fc") || // unique local
      host.startsWith("fd")
    ) {
      return true;
    }
    return false;
  }

  return false;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (isPrivateUrl(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = r.headers.get("content-type") || mimeFromExt(extFromPath(url));
    return `data:${ct};base64,${bytesToBase64(buf)}`;
  } catch {
    return null;
  }
}

async function readLocalAsDataUrl(absPath: string): Promise<string | null> {
  try {
    const bytes = await readFile(absPath);
    const u8 =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as any);
    const ext = extFromPath(absPath);
    return `data:${mimeFromExt(ext)};base64,${bytesToBase64(u8)}`;
  } catch {
    return null;
  }
}

export async function inlineImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;
      const local = decodeTauriAsset(src);
      if (local) {
        const d = await readLocalAsDataUrl(local);
        if (d) img.setAttribute("src", d);
        return;
      }
      if (isExternal(src)) {
        const d = await fetchAsDataUrl(src);
        if (d) img.setAttribute("src", d);
      }
    })
  );
}

export function ensureSvgNamespace(root: HTMLElement): void {
  root.querySelectorAll<SVGSVGElement>("svg").forEach((svg) => {
    if (!svg.getAttribute("xmlns")) {
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
  });
}
