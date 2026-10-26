import { storage } from '@/storage/client.ts';

const cache = new Map<string, Promise<string | null>>();

/**
 * Small thumbnails: `createImageBitmap` at the requested size,
 * cached per path + lastModified, generated lazily by the visible rows.
 */
export function thumbnail(docId: string, path: string, lastModified: number, size = 40): Promise<string | null> {
  const key = `${docId}:${path}:${lastModified}:${size}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const file = await storage.readAsset(docId, path);
        if (file.type === 'image/svg+xml') return URL.createObjectURL(file);
        const bmp = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'medium' });
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d')?.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        return blob ? URL.createObjectURL(blob) : null;
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
  }
  return p;
}

/** Full-size object URL for previews; revoked by the caller. */
export async function previewUrl(docId: string, path: string): Promise<{ url: string; width: number; height: number } | null> {
  try {
    const file = await storage.readAsset(docId, path);
    const url = URL.createObjectURL(file);
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
    return { url, ...dims };
  } catch {
    return null;
  }
}
