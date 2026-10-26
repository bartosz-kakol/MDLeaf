/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { animatedImage, sniffImageType, svgSize } from './imageInfo.ts';

export interface ImageWorkerApi {
  probe(file: Blob): Promise<{ width: number; height: number; type: string; animated: boolean }>;
  transcode(
    file: Blob,
    opts: { maxWidth: number | null; format: 'jpeg' | 'webp'; quality: number },
  ): Promise<{ blob: Blob; width: number; height: number }>;
}

async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

const api: ImageWorkerApi = {
  async probe(file) {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const type = file.type || sniffImageType(head) || 'application/octet-stream';
    if (type === 'image/svg+xml') {
      const size = svgSize(await file.text());
      return { ...size, type, animated: false };
    }
    const animated = animatedImage(type, new Uint8Array(await file.arrayBuffer()));
    const bmp = await bitmapOf(file);
    const out = { width: bmp.width, height: bmp.height, type, animated };
    bmp.close();
    return out;
  },

  async transcode(file, opts) {
    const bmp = await bitmapOf(file);
    const targetW = Math.max(1, Math.min(opts.maxWidth ?? bmp.width, bmp.width));
    const targetH = Math.max(1, Math.round((bmp.height * targetW) / bmp.width));
    // Step down by halves while the scale is below 0.5, to avoid aliasing.
    let source: ImageBitmap | OffscreenCanvas = bmp;
    let w = bmp.width;
    let h = bmp.height;
    while (w / 2 >= targetW * 1.0 && w / targetW > 2) {
      const nw = Math.max(targetW, Math.round(w / 2));
      const nh = Math.max(targetH, Math.round(h / 2));
      const step = new OffscreenCanvas(nw, nh);
      const sctx = step.getContext('2d')!;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(source, 0, 0, nw, nh);
      source = step;
      w = nw;
      h = nh;
    }
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    if (opts.format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(source, 0, 0, targetW, targetH);
    bmp.close();
    const data = ctx.getImageData(0, 0, targetW, targetH);
    const quality = Math.min(100, Math.max(1, Math.round(opts.quality)));
    let buffer: ArrayBuffer;
    if (opts.format === 'webp') {
      const { encode } = await import('@jsquash/webp');
      buffer = await encode(data, { quality });
    } else {
      const { encode } = await import('@jsquash/jpeg');
      buffer = await encode(data, { quality });
    }
    const blob = new Blob([buffer], { type: opts.format === 'webp' ? 'image/webp' : 'image/jpeg' });
    return Comlink.transfer({ blob, width: targetW, height: targetH }, []);
  },
};

Comlink.expose(api);
