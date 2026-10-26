import { type Profile, validateProfile } from '@mdleaf/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { allProfiles, findProfile, toast, useProfileStore, useSettingsStore } from '@/state/stores.ts';
import { storage } from '@/storage/client.ts';
import { Badge, Button, cx, Dialog, Field, Input, Select } from '../ui.tsx';
import { LayoutEditor } from './LayoutEditor.tsx';

export async function reloadProfiles(): Promise<void> {
  useProfileStore.getState().setUserProfiles(await storage.listProfiles());
}

function uniqueCopyName(base: string): string {
  const taken = new Set(allProfiles().map((p) => p.name.toLowerCase()));
  const first = `${base} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; ; n++) {
    const name = `${base} (copy ${n})`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export async function createProfileFrom(source: Pick<Profile, 'themeId' | 'layout' | 'headerFooter'>, name: string): Promise<Profile> {
  const now = new Date().toISOString();
  const profile: Profile = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    builtin: false,
    themeId: source.themeId,
    layout: structuredClone(source.layout),
    headerFooter: { ...source.headerFooter },
    createdAt: now,
    updatedAt: now,
  };
  const saved = await storage.saveProfile(profile);
  await reloadProfiles();
  return saved;
}

function DeleteProfileDialog({ profile, onClose }: { profile: Profile; onClose(): void }) {
  const defaultId = useSettingsStore((s) => s.settings.defaultProfileId);
  const [docs, setDocs] = useState<Array<{ id: string; title: string }> | null>(null);
  const [replacement, setReplacement] = useState(defaultId === profile.id ? 'builtin:default-a4' : defaultId);
  useEffect(() => {
    void storage
      .listDocuments()
      .then((list) => setDocs(list.filter((d) => d.profileId === profile.id).map((d) => ({ id: d.id, title: d.title }))));
  }, [profile.id]);
  const confirm = async () => {
    await storage.deleteProfile(profile.id, replacement);
    await reloadProfiles();
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete '${profile.name}'?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={docs === null}>
            Delete
          </Button>
        </>
      }
    >
      {docs?.length ? (
        <>
          <p className="mb-2 text-[13px]">
            {docs.length} document{docs.length === 1 ? ' uses' : 's use'} this profile:
          </p>
          <ul className="mb-3 list-disc pl-5 text-[13px]">
            {docs.slice(0, 10).map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
            {docs.length > 10 ? <li>and {docs.length - 10} more</li> : null}
          </ul>
          <Field label="Switch them to" htmlFor="del-repl">
            <Select id="del-repl" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
              {allProfiles()
                .filter((p) => p.id !== profile.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        </>
      ) : (
        <p className="text-[13px] text-fg-muted">No documents use this profile.</p>
      )}
    </Dialog>
  );
}

export function ProfilesTab() {
  const userProfiles = useProfileStore((s) => s.userProfiles);
  const builtins = useProfileStore((s) => s.builtins);
  const defaultId = useSettingsStore((s) => s.settings.defaultProfileId);
  const [selectedId, setSelectedId] = useState(defaultId);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profiles = useMemo(() => [...builtins, ...userProfiles], [builtins, userProfiles]);
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0];

  // Reset the form only when another profile is selected, not on every save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the selected id
  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
  }, [selected?.id]);

  const errors = draft ? validateProfile(draft) : [];
  const nameTaken = !!draft && profiles.some((p) => p.id !== draft.id && p.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const readOnly = !!selected?.builtin;

  const change = (next: Profile) => {
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const errs = validateProfile(next);
    const taken = profiles.some((p) => p.id !== next.id && p.name.trim().toLowerCase() === next.name.trim().toLowerCase());
    if (errs.length || taken || next.builtin) return;
    saveTimer.current = setTimeout(() => {
      void storage.saveProfile({ ...next, name: next.name.trim() }).then(reloadProfiles);
    }, 300);
  };

  const duplicate = async (p: Profile) => {
    const created = await createProfileFrom(p, uniqueCopyName(p.name));
    setSelectedId(created.id);
  };

  return (
    <div className="flex gap-4">
      <div className="w-52 shrink-0">
        <h3 className="mb-2 text-[14px] font-semibold">Profiles</h3>
        <div role="listbox" aria-label="Profiles" className="mb-2 max-h-[420px] overflow-auto rounded-md border border-border p-1">
          {profiles.map((p) => (
            <div
              key={p.id}
              role="option"
              aria-selected={p.id === selected?.id}
              tabIndex={0}
              onClick={() => setSelectedId(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedId(p.id)}
              className={cx(
                'flex cursor-default items-center gap-1 rounded px-2 py-1 text-[13px]',
                p.id === selected?.id ? 'bg-accent-soft' : 'hover:bg-bg-hover',
              )}
            >
              <span className="flex-1 truncate">{p.name}</span>
              {p.builtin ? <Badge>Built-in</Badge> : null}
              {p.id === defaultId ? <Badge tone="accent">Default</Badge> : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            onClick={() => {
              const taken = new Set(allProfiles().map((p) => p.name.toLowerCase()));
              let name = 'New profile';
              for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New profile ${n}`;
              void createProfileFrom(findProfile(defaultId) ?? builtins[0], name).then((p) => setSelectedId(p.id));
            }}
          >
            New profile
          </Button>
          <Button size="sm" disabled={!selected} onClick={() => selected && void duplicate(selected)}>
            Duplicate
          </Button>
          <Button
            size="sm"
            disabled={!selected || selected.builtin || selected.id === defaultId}
            title={selected?.id === defaultId ? 'Make another profile the default first' : undefined}
            onClick={() => selected && setDeleting(selected)}
          >
            Delete…
          </Button>
        </div>
      </div>
      {draft ? (
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-bg-subtle p-2 text-[13px]">
              <span className="flex-1">Built-in profiles are read-only.</span>
              <Button size="sm" onClick={() => void duplicate(selected)}>
                Duplicate to edit
              </Button>
            </div>
          ) : null}
          <Field
            label="Name"
            htmlFor="prof-name"
            error={errors.find((e) => e.field === 'name')?.message ?? (nameTaken ? 'Another profile already has this name' : null)}
          >
            <Input
              id="prof-name"
              disabled={readOnly}
              value={draft.name}
              maxLength={80}
              onChange={(e) => change({ ...draft, name: e.target.value })}
            />
          </Field>
          <LayoutEditor
            value={draft}
            disabled={readOnly}
            errors={errors}
            onChange={(v) => change({ ...draft, themeId: v.themeId, layout: v.layout, headerFooter: v.headerFooter })}
          />
          <div className="mt-4">
            <Button
              disabled={draft.id === defaultId}
              onClick={() => {
                useSettingsStore.getState().update((s) => {
                  s.defaultProfileId = draft.id;
                });
                toast(`'${draft.name}' is now the default profile.`);
              }}
            >
              Set as default
            </Button>
          </div>
        </div>
      ) : null}
      {deleting ? <DeleteProfileDialog profile={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
