import type { Profile } from '../types.ts';

const EPOCH = '2026-01-01T00:00:00.000Z';

export const BUILTIN_PROFILES: readonly Profile[] = [
  {
    schemaVersion: 1,
    id: 'builtin:default-a4',
    name: 'Default (A4)',
    builtin: true,
    themeId: 'preset:classic',
    layout: {
      size: { preset: 'A4', widthMm: 210, heightMm: 297 },
      orientation: 'portrait',
      marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
    },
    headerFooter: { hideHeaderOnFirstPage: false, hideFooterOnFirstPage: false },
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    schemaVersion: 1,
    id: 'builtin:default-letter',
    name: 'Default (Letter)',
    builtin: true,
    themeId: 'preset:classic',
    layout: {
      size: { preset: 'Letter', widthMm: 215.9, heightMm: 279.4 },
      orientation: 'portrait',
      marginsMm: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    },
    headerFooter: { hideHeaderOnFirstPage: false, hideFooterOnFirstPage: false },
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
];

export const PAGE_PRESETS = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
} as const;

export function isBuiltinProfileId(id: string): boolean {
  return id.startsWith('builtin:');
}

export function findBuiltinProfile(id: string): Profile | undefined {
  return BUILTIN_PROFILES.find((p) => p.id === id);
}
