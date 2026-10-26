import type { RenderResult } from '../markdown/render.ts';
import type { OversizedReport } from '../paginate/handlers.ts';
import type { RenderDiagnostic } from '../syntax/diagnostics.ts';
import type { EffectiveProfile } from '../types.ts';

export type PreviewMode = 'draft' | 'page';
export type Zoom = 'fit' | number;

/** host → iframe */
export type HostMessage =
  | {
      type: 'render';
      renderId: number;
      mode: PreviewMode;
      markdown: string;
      docTitle: string;
      profile: EffectiveProfile;
      themeCss: string;
      assetUrls: Record<string, string>;
      zoom: Zoom;
    }
  | { type: 'scroll'; line: number; fraction: number; animate: boolean }
  | { type: 'zoom'; zoom: Zoom };

/** iframe → host */
export type PreviewMessage =
  | { type: 'ready' }
  | {
      type: 'rendered';
      renderId: number;
      mode: PreviewMode;
      durationMs: number;
      pageCount: number | null;
      headings: RenderResult['headings'];
      oversized: OversizedReport[];
      diagnostics: RenderDiagnostic[];
    }
  | { type: 'render-error'; renderId: number; message: string }
  | { type: 'link'; href: string }
  | {
      type: 'key';
      key: string;
      code: string;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
    }
  | { type: 'afterprint' };

export type RenderMessage = Extract<HostMessage, { type: 'render' }>;
export type RenderedMessage = Extract<PreviewMessage, { type: 'rendered' }>;
