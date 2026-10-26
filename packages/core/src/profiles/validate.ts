import type { PageLayout, Profile } from '../types.ts';
import { PAGE_PRESETS } from './builtin.ts';

export interface ValidationError {
  /** Dotted field path, e.g. "layout.marginsMm.left". */
  field: string;
  message: string;
}

const hasPrecision01 = (n: number) => Math.abs(Math.round(n * 10) - n * 10) < 1e-6;

export function validateLayout(layout: PageLayout): ValidationError[] {
  const errors: ValidationError[] = [];
  const { size, marginsMm } = layout;
  if (size.preset !== 'custom') {
    const p = PAGE_PRESETS[size.preset];
    if (!p || size.widthMm !== p.widthMm || size.heightMm !== p.heightMm) {
      errors.push({ field: 'layout.size', message: `${size.preset} is ${p?.widthMm} × ${p?.heightMm} mm` });
    }
  } else {
    for (const [k, v] of [
      ['widthMm', size.widthMm],
      ['heightMm', size.heightMm],
    ] as const) {
      if (!Number.isFinite(v) || v < 50 || v > 1000) {
        errors.push({ field: `layout.size.${k}`, message: 'Must be between 50 and 1000 mm' });
      } else if (!hasPrecision01(v)) {
        errors.push({ field: `layout.size.${k}`, message: 'Use at most one decimal place (0.1 mm)' });
      }
    }
  }
  if (layout.orientation !== 'portrait' && layout.orientation !== 'landscape') {
    errors.push({ field: 'layout.orientation', message: 'Must be portrait or landscape' });
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = marginsMm[side];
    if (!Number.isFinite(v) || v < 0) errors.push({ field: `layout.marginsMm.${side}`, message: 'Must be 0 mm or more' });
  }
  const { width, height } = orientedSize(layout);
  if (marginsMm.left + marginsMm.right > width - 20) {
    errors.push({
      field: 'layout.marginsMm.left',
      message: `Left + right margins must be at most ${round1(width - 20)} mm`,
    });
  }
  if (marginsMm.top + marginsMm.bottom > height - 20) {
    errors.push({
      field: 'layout.marginsMm.top',
      message: `Top + bottom margins must be at most ${round1(height - 20)} mm`,
    });
  }
  return errors;
}

export function validateProfile(p: Pick<Profile, 'name' | 'layout' | 'themeId'>): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = p.name.trim();
  if (name.length < 1 || name.length > 80) errors.push({ field: 'name', message: 'Name must be 1–80 characters' });
  if (!p.themeId) errors.push({ field: 'themeId', message: 'Choose a theme' });
  errors.push(...validateLayout(p.layout));
  return errors;
}

/** Physical page size after applying orientation. */
export function orientedSize(layout: PageLayout): { width: number; height: number } {
  const { widthMm, heightMm } = layout.size;
  return layout.orientation === 'landscape' ? { width: heightMm, height: widthMm } : { width: widthMm, height: heightMm };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Content key used for profile matching on `.mdl` import. */
export function profileContentKey(p: Pick<Profile, 'themeId' | 'layout' | 'headerFooter'>): string {
  const l = p.layout;
  return JSON.stringify([
    p.themeId,
    l.size.preset,
    l.size.widthMm,
    l.size.heightMm,
    l.orientation,
    l.marginsMm.top,
    l.marginsMm.right,
    l.marginsMm.bottom,
    l.marginsMm.left,
    !!p.headerFooter.hideHeaderOnFirstPage,
    !!p.headerFooter.hideFooterOnFirstPage,
  ]);
}

/** Basic structural check of a parsed profile object (import). */
export function isProfileShape(v: unknown): v is Profile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Profile;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.themeId === 'string' &&
    !!p.layout &&
    !!p.layout.size &&
    typeof p.layout.size.widthMm === 'number' &&
    typeof p.layout.size.heightMm === 'number' &&
    !!p.layout.marginsMm &&
    !!p.headerFooter
  );
}
