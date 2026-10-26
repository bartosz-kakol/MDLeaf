import type { Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { BUILTIN_PROFILES, type EffectiveProfile, type PageLayout, type RenderedMessage } from '../../../packages/core/src/index.ts';
import { fixture } from './app.ts';

const classicCss = fixture('../../packages/core/src/themes/presets/classic.css');

export function profileFor(layout?: Partial<PageLayout>, hideFirst = false): EffectiveProfile {
  const base = BUILTIN_PROFILES[0];
  return {
    schemaVersion: 1,
    id: base.id,
    name: base.name,
    builtin: true,
    themeId: base.themeId,
    layout: { ...base.layout, ...layout },
    headerFooter: { hideHeaderOnFirstPage: hideFirst, hideFooterOnFirstPage: hideFirst },
    sourceProfileId: base.id,
    overridden: [],
  };
}

/** Opens /preview.html?mode=page directly and drives it with a render message. */
export async function renderPages(page: Page, markdown: string, profile: EffectiveProfile = profileFor()): Promise<RenderedMessage> {
  await page.goto('/preview.html?mode=page');
  return page.evaluate(
    ([md, prof, css]) =>
      new Promise<RenderedMessage>((resolve, reject) => {
        window.addEventListener('mdleaf-preview', (e) => {
          const msg = (e as CustomEvent).detail as { type: string };
          if (msg.type === 'rendered') resolve(msg as RenderedMessage);
          if (msg.type === 'render-error') reject(new Error(JSON.stringify(msg)));
        });
        window.postMessage(
          {
            type: 'render',
            renderId: 1,
            mode: 'page',
            markdown: md,
            docTitle: 'Test',
            profile: prof,
            themeCss: css,
            assetUrls: {},
            zoom: 1,
          },
          location.origin,
        );
      }),
    [markdown, profile, classicCss] as const,
  );
}

export async function makePdf(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  return getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false }).promise;
}

export async function pageText(pdf: Awaited<ReturnType<typeof makePdf>>, n: number): Promise<string> {
  const p = await pdf.getPage(n);
  const content = await p.getTextContent();
  return content.items
    .map((i) => ('str' in i ? i.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}
