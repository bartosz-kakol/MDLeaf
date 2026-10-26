/** Pure asset path helpers. */

export const OUTSIDE = 'OUTSIDE' as const;
export type RefPath = string | typeof OUTSIDE;

export const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'] as const;

export const ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'];

export const MAX_SEGMENT_LENGTH = 120;
export const MAX_PATH_LENGTH = 1024;

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  if (SCHEME_RE.test(url)) return false;
  if (url.startsWith('/') || url.startsWith('#')) return false;
  return true;
}

/**
 * Turns a Markdown URL into a canonical document-relative path, `null` when
 * the URL is not relative, or `OUTSIDE` when it escapes the document root.
 */
export function normalizeRef(url: string): RefPath | null {
  const raw = url.trim();
  if (!isRelativeUrl(raw)) return null;
  let s = raw;
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  let decoded: string;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    return raw;
  }
  const out: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return OUTSIDE;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  if (out.length === 0) return OUTSIDE;
  return out.join('/').normalize('NFC');
}

/** Percent-encodes every character outside `[A-Za-z0-9._~/-]`. */
export function encodeRefPath(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      Array.from(seg)
        .map((ch) =>
          /^[A-Za-z0-9._~-]$/.test(ch)
            ? ch
            : Array.from(new TextEncoder().encode(ch), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
        )
        .join(''),
    )
    .join('/');
}

export function isUnderAssets(path: string): boolean {
  return path.startsWith('assets/') && path.length > 'assets/'.length;
}

export function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

export function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder.replace(/\/+$/, '')}/${name}` : name;
}

/** Validates one folder/file name segment; returns an error message or null. */
export function validateSegment(seg: string): string | null {
  if (seg.length < 1) return 'The name cannot be empty';
  if (seg.length > MAX_SEGMENT_LENGTH) return `The name can have at most ${MAX_SEGMENT_LENGTH} characters`;
  if (seg === '.' || seg === '..') return 'This name is not allowed';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
  if (/[/\\:*?"<>|\u0000-\u001f\u007f]/.test(seg)) return 'The name cannot contain / \\ : * ? " < > | or control characters';
  if (seg.startsWith('.')) return 'The name cannot start with a dot';
  if (/[ .]$/.test(seg)) return 'The name cannot end with a space or a dot';
  return null;
}

/** Validates a canonical asset path (file when `file` is true, else a folder). */
export function validateAssetPath(path: string, file: boolean): string | null {
  if (path.length > MAX_PATH_LENGTH) return `The path can have at most ${MAX_PATH_LENGTH} characters`;
  const segs = path.split('/');
  if (segs[0] !== 'assets') return 'Assets must be stored under assets/';
  if (file && segs.length < 2) return 'Invalid file path';
  for (const s of segs.slice(1)) {
    const err = validateSegment(s);
    if (err) return err;
  }
  if (file && !(ASSET_EXTENSIONS as readonly string[]).includes(extname(path))) {
    return 'Only PNG, JPEG, GIF, WebP, AVIF and SVG images can be assets';
  }
  return null;
}

/** Removes characters that are not allowed in a segment (for default names). */
export function sanitizeStem(stem: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped
  let s = stem.normalize('NFC').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-');
  s = s.replace(/^\.+/, '').replace(/[ .]+$/, '');
  if (s.length > MAX_SEGMENT_LENGTH - 6) s = s.slice(0, MAX_SEGMENT_LENGTH - 6);
  return s || 'image';
}

export function mimeForPath(path: string): string {
  return ASSET_MIME_TYPES[extname(path)] ?? 'application/octet-stream';
}

export function extensionForMime(type: string): string | null {
  switch (type) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/avif':
      return '.avif';
    case 'image/svg+xml':
      return '.svg';
    default:
      return null;
  }
}

/** Lowercase, dash-separated slug for file names (exports). */
export function slugifyTitle(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'document';
}
