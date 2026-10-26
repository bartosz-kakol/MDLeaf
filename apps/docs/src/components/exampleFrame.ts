import type { EffectiveProfile } from '@mdleaf/core';
import type { PreviewRuntime } from '@mdleaf/core/preview-runtime';

interface ExampleData {
  title: string;
  markdown: string;
  profile: EffectiveProfile;
  themeCss: string;
  assets: Record<string, string>;
  defaultMode: 'page' | 'draft';
}

/** Renders one docs example inside the preview frame and reports the result to the parent page. */
export async function runExample(start: (o: { mode: 'draft' | 'page'; listen: boolean }) => PreviewRuntime): Promise<void> {
  const params = new URLSearchParams(location.search);
  const name = params.get('example') ?? '';
  const res = await fetch(`/examples-data/${encodeURIComponent(name)}.json`);
  const data = (await res.json()) as ExampleData;
  const mode = params.get('mode') === 'page' ? 'page' : params.get('mode') === 'draft' ? 'draft' : data.defaultMode;
  const runtime = start({ mode, listen: false });
  const rendered = await runtime.render({
    type: 'render',
    renderId: 1,
    mode,
    markdown: data.markdown,
    docTitle: data.title,
    profile: data.profile,
    themeCss: data.themeCss,
    assetUrls: data.assets,
    zoom: 'fit',
  });
  const errors = rendered.diagnostics.filter((d) => d.severity === 'error').length;
  const root = document.documentElement;
  root.dataset.rendered = 'true';
  root.dataset.errors = String(errors);
  root.dataset.pages = String(rendered.pageCount ?? 0);
  window.parent.postMessage({ type: 'mdleaf-docs-rendered', name, mode, errors, pageCount: rendered.pageCount }, location.origin);
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    const msg = e.data as { type?: string; mode?: string };
    if (msg?.type === 'mdleaf-docs-mode' && (msg.mode === 'page' || msg.mode === 'draft') && msg.mode !== mode) {
      const url = new URL(location.href);
      url.searchParams.set('mode', msg.mode);
      location.replace(url.toString());
    }
  });
}
