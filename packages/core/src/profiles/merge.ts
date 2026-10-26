import type { EffectiveProfile, PageLayout, Profile, ProfileOverrides } from '../types.ts';
import { orientedSize, validateLayout } from './validate.ts';

export interface EffectiveProfileResult extends EffectiveProfile {}

function mergeLayout(base: PageLayout, o: ProfileOverrides['layout'], overridden: string[]): PageLayout {
  const layout: PageLayout = {
    size: { ...base.size },
    orientation: base.orientation,
    marginsMm: { ...base.marginsMm },
  };
  if (!o) return layout;
  if (o.size) {
    layout.size = { ...o.size };
    overridden.push('layout.size');
  }
  if (o.orientation) {
    layout.orientation = o.orientation;
    overridden.push('layout.orientation');
  }
  if (o.marginsMm) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const v = o.marginsMm[side];
      if (typeof v === 'number') {
        layout.marginsMm[side] = v;
        overridden.push(`layout.marginsMm.${side}`);
      }
    }
  }
  return layout;
}

/**
 * Merges per-document overrides into a profile, field by field. If the
 * merged layout is invalid, the profile's own layout is used and
 * `invalidOverride` is set so the UI can report `profile-invalid-override`.
 */
export function resolveEffectiveProfile(profile: Profile, overrides: ProfileOverrides): EffectiveProfile & { invalidOverride: boolean } {
  const overridden: string[] = [];
  let themeId = profile.themeId;
  if (overrides.themeId) {
    themeId = overrides.themeId;
    overridden.push('themeId');
  }
  let layout = mergeLayout(profile.layout, overrides.layout, overridden);
  let invalidOverride = false;
  if (overrides.layout && validateLayout(layout).length > 0) {
    invalidOverride = true;
    layout = mergeLayout(profile.layout, undefined, []);
    for (let i = overridden.length - 1; i >= 0; i--) if (overridden[i].startsWith('layout.')) overridden.splice(i, 1);
  }
  const headerFooter = { ...profile.headerFooter };
  for (const k of ['hideHeaderOnFirstPage', 'hideFooterOnFirstPage'] as const) {
    const v = overrides.headerFooter?.[k];
    if (typeof v === 'boolean') {
      headerFooter[k] = v;
      overridden.push(`headerFooter.${k}`);
    }
  }
  return {
    schemaVersion: 1,
    id: profile.id,
    name: profile.name,
    builtin: profile.builtin,
    themeId,
    layout,
    headerFooter,
    sourceProfileId: profile.id,
    overridden,
    invalidOverride,
  };
}

export interface PageGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  margins: PageLayout['marginsMm'];
}

export function pageGeometry(layout: PageLayout): PageGeometry {
  const { width, height } = orientedSize(layout);
  const m = layout.marginsMm;
  return {
    pageWidthMm: width,
    pageHeightMm: height,
    contentWidthMm: round3(width - m.left - m.right),
    contentHeightMm: round3(height - m.top - m.bottom),
    margins: m,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const mm = (n: number) => `${round3(n)}mm`;

/** Generates the `@page` rule and the read-only layout custom properties. */
export function layoutToPageCss(profile: Pick<EffectiveProfile, 'layout'>): string {
  const g = pageGeometry(profile.layout);
  const m = g.margins;
  return `@page { size: ${mm(g.pageWidthMm)} ${mm(g.pageHeightMm)}; margin: ${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)}; }
:root { --mdl-page-width: ${mm(g.pageWidthMm)}; --mdl-page-height: ${mm(g.pageHeightMm)}; --mdl-margin-top: ${mm(m.top)};
        --mdl-margin-right: ${mm(m.right)}; --mdl-margin-bottom: ${mm(m.bottom)}; --mdl-margin-left: ${mm(m.left)};
        --mdl-content-width: ${mm(g.contentWidthMm)}; --mdl-content-height: ${mm(g.contentHeightMm)}; }
`;
}

/** Applies a dotted-path override (used by the document settings dialog). */
export function setOverride(overrides: ProfileOverrides, path: string, value: unknown): ProfileOverrides {
  const next: ProfileOverrides = structuredClone(overrides);
  switch (path) {
    case 'themeId':
      if (value === undefined) delete next.themeId;
      else next.themeId = value as string;
      break;
    case 'layout.size':
    case 'layout.orientation': {
      const key = path.slice('layout.'.length) as 'size' | 'orientation';
      next.layout ??= {};
      if (value === undefined) delete next.layout[key];
      else (next.layout as Record<string, unknown>)[key] = value;
      break;
    }
    case 'headerFooter.hideHeaderOnFirstPage':
    case 'headerFooter.hideFooterOnFirstPage': {
      const key = path.slice('headerFooter.'.length) as 'hideHeaderOnFirstPage' | 'hideFooterOnFirstPage';
      next.headerFooter ??= {};
      if (value === undefined) delete next.headerFooter[key];
      else next.headerFooter[key] = value as boolean;
      break;
    }
    default:
      if (path.startsWith('layout.marginsMm.')) {
        const side = path.slice('layout.marginsMm.'.length) as 'top' | 'right' | 'bottom' | 'left';
        next.layout ??= {};
        next.layout.marginsMm ??= {};
        if (value === undefined) delete next.layout.marginsMm[side];
        else next.layout.marginsMm[side] = value as number;
        if (Object.keys(next.layout.marginsMm).length === 0) delete next.layout.marginsMm;
      }
  }
  if (next.layout && Object.keys(next.layout).length === 0) delete next.layout;
  if (next.headerFooter && Object.keys(next.headerFooter).length === 0) delete next.headerFooter;
  return next;
}

export function countOverrides(overrides: ProfileOverrides): number {
  let n = overrides.themeId ? 1 : 0;
  if (overrides.layout?.size) n++;
  if (overrides.layout?.orientation) n++;
  n += Object.keys(overrides.layout?.marginsMm ?? {}).length;
  n += Object.keys(overrides.headerFooter ?? {}).length;
  return n;
}
