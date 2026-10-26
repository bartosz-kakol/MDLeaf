/** Pure helpers for image probing (used by the image worker; unit-tested). */

export function sniffImageType(b: Uint8Array): string | null {
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (s(4, 8) === 'ftypavif' || s(4, 8) === 'ftypavis') return 'image/avif';
  const text = new TextDecoder().decode(b.slice(0, 512)).trimStart();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/** Detects animated GIF (more than one frame), animated WebP (ANIM chunk) and APNG (acTL chunk). */
export function animatedImage(type: string, b: Uint8Array): boolean {
  if (type === 'image/gif') {
    let frames = 0;
    // Count Graphic Control Extensions followed by image descriptors.
    for (let i = 0; i < b.length - 2; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) {
        frames++;
        if (frames > 1) return true;
      }
    }
    return false;
  }
  if (type === 'image/webp') {
    for (let i = 12; i <= Math.min(b.length - 4, 1 << 16); i++) {
      if (b[i] === 0x41 && b[i + 1] === 0x4e && b[i + 2] === 0x49 && b[i + 3] === 0x4d) return true; // "ANIM"
    }
    return false;
  }
  if (type === 'image/png') {
    for (let i = 8; i <= Math.min(b.length - 4, 1 << 16); i++) {
      if (b[i] === 0x61 && b[i + 1] === 0x63 && b[i + 2] === 0x54 && b[i + 3] === 0x4c) return true; // "acTL"
      if (b[i] === 0x49 && b[i + 1] === 0x44 && b[i + 2] === 0x41 && b[i + 3] === 0x54) return false; // "IDAT"
    }
  }
  return false;
}

function parseLength(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

export function svgSize(text: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
  let width = parseLength(attr('width'));
  let height = parseLength(attr('height'));
  const vb = attr('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  if (vb && vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
    if (width === null && height === null) {
      width = vb[2];
      height = vb[3];
    } else if (width === null && height !== null) width = (height * vb[2]) / vb[3];
    else if (height === null && width !== null) height = (width * vb[3]) / vb[2];
  }
  return { width: Math.round(width ?? 300), height: Math.round(height ?? 150) };
}
