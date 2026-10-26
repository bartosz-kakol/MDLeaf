import { BUILTIN_PROFILES, type ProfileOverrides, resolveEffectiveProfile, setOverride, validateLayout } from '@mdleaf/core';
import { useEffect, useRef, useState } from 'react';
import { updateMeta } from '@/services/session.ts';
import { allProfiles, findProfile, useDocStore, useProfileStore, useSettingsStore } from '@/state/stores.ts';
import { confirmDialog, promptDialog, useUiStore } from '@/state/ui.ts';
import { Button, Dialog, Field, Select } from '../ui.tsx';
import { LayoutEditor, type LayoutValue } from './LayoutEditor.tsx';
import { createProfileFrom } from './ProfilesTab.tsx';

const FIELDS = [
  'themeId',
  'layout.size',
  'layout.orientation',
  'layout.marginsMm.top',
  'layout.marginsMm.right',
  'layout.marginsMm.bottom',
  'layout.marginsMm.left',
  'headerFooter.hideHeaderOnFirstPage',
  'headerFooter.hideFooterOnFirstPage',
];

function getAt(v: LayoutValue, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v);
}

function isOverridden(o: ProfileOverrides, path: string): boolean {
  return getAt(o as unknown as LayoutValue, path) !== undefined;
}

export function DocSettingsDialog() {
  const open = useUiStore((s) => s.docSettings);
  const meta = useDocStore((s) => s.meta);
  useProfileStore((s) => s.userProfiles);
  const [overrides, setOverrides] = useState<ProfileOverrides>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only reset when the dialog opens; meta changes while editing must not reset the form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open is the trigger
  useEffect(() => {
    if (open && meta) setOverrides(structuredClone(meta.overrides));
  }, [open]);

  if (!open || !meta) return null;
  const profile = findProfile(meta.profileId) ?? findProfile(useSettingsStore.getState().settings.defaultProfileId) ?? BUILTIN_PROFILES[0];
  const merged = resolveEffectiveProfile(profile, overrides);
  // Show the merged values even when invalid, so the user sees what they typed.
  const shown: LayoutValue = {
    themeId: overrides.themeId ?? profile.themeId,
    layout: {
      size: overrides.layout?.size ?? profile.layout.size,
      orientation: overrides.layout?.orientation ?? profile.layout.orientation,
      marginsMm: { ...profile.layout.marginsMm, ...overrides.layout?.marginsMm },
    },
    headerFooter: { ...profile.headerFooter, ...overrides.headerFooter },
  };
  const errors = validateLayout(shown.layout);

  const save = (next: ProfileOverrides) => {
    setOverrides(next);
    if (timer.current) clearTimeout(timer.current);
    const layout = resolveEffectiveProfile(profile, next);
    if (layout.invalidOverride) return;
    timer.current = setTimeout(() => void updateMeta({ overrides: next }), 300);
  };

  const onChange = (v: LayoutValue) => {
    let next = overrides;
    for (const f of FIELDS) {
      if (!isOverridden(overrides, f)) continue;
      next = setOverride(next, f, getAt(v, f));
    }
    save(next);
  };

  const toggle = (path: string, on: boolean) => save(setOverride(overrides, path, on ? getAt(shown, path) : undefined));

  const wrap = (path: string, field: React.ReactNode) => (
    <div key={path} className="flex items-start gap-2">
      <label className="mt-0.5 flex shrink-0 items-center" title="Override">
        <input
          type="checkbox"
          aria-label={`Override ${path}`}
          checked={isOverridden(overrides, path)}
          onChange={(e) => toggle(path, e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
      </label>
      <div className="min-w-0 flex-1">
        {field}
        {!isOverridden(overrides, path) && !path.startsWith('layout.marginsMm') ? (
          <p className="-mt-2 mb-2 text-[11px] text-fg-subtle">From profile '{profile.name}'</p>
        ) : null}
      </div>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && useUiStore.getState().set({ docSettings: false })}
      title="Document settings"
      width="max-w-3xl"
      footer={
        <>
          <Button
            className="mr-auto"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Clear all overrides?',
                message: 'This document will use its profile’s settings again.',
                confirmLabel: 'Clear overrides',
              });
              if (ok === 'confirm') {
                setOverrides({});
                await updateMeta({ overrides: {} });
              }
            }}
          >
            Clear all overrides
          </Button>
          <Button
            disabled={merged.invalidOverride}
            onClick={async () => {
              const name = await promptDialog({
                title: 'Save as new profile',
                label: 'Profile name',
                initial: `${meta.title} profile`,
                confirmLabel: 'Create profile',
                validate: (v) =>
                  !v.trim() || v.trim().length > 80
                    ? 'Name must be 1–80 characters'
                    : allProfiles().some((p) => p.name.toLowerCase() === v.trim().toLowerCase())
                      ? 'Another profile already has this name'
                      : null,
              });
              if (!name) return;
              const created = await createProfileFrom(merged, name.trim());
              setOverrides({});
              await updateMeta({ profileId: created.id, overrides: {} });
            }}
          >
            Save as new profile…
          </Button>
          <Button variant="primary" onClick={() => useUiStore.getState().set({ docSettings: false })}>
            Done
          </Button>
        </>
      }
    >
      <Field label="Profile" htmlFor="doc-profile" hint="Changes below apply only to this document.">
        <Select id="doc-profile" value={meta.profileId} onChange={(e) => void updateMeta({ profileId: e.target.value })}>
          {allProfiles().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {!findProfile(meta.profileId) ? <option value={meta.profileId}>Missing profile</option> : null}
        </Select>
      </Field>
      <div className="mt-2">
        <LayoutEditor value={shown} onChange={onChange} errors={errors} wrap={wrap} isDisabled={(p) => !isOverridden(overrides, p)} />
      </div>
    </Dialog>
  );
}
