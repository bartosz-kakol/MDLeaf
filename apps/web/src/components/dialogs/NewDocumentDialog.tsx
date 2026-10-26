import { useEffect, useState } from 'react';
import { createNewDocument } from '@/services/fileOps.ts';
import { allProfiles, useProfileStore, useSettingsStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { Button, Dialog, Field, Input, Select } from '../ui.tsx';

export function NewDocumentDialog() {
  const open = useUiStore((s) => s.newDocument);
  const defaultProfileId = useSettingsStore((s) => s.settings.defaultProfileId);
  useProfileStore((s) => s.userProfiles);
  const [title, setTitle] = useState('Untitled');
  const [profileId, setProfileId] = useState(defaultProfileId);
  useEffect(() => {
    if (open) {
      setTitle('Untitled');
      setProfileId(defaultProfileId);
    }
  }, [open, defaultProfileId]);
  const close = () => useUiStore.getState().set({ newDocument: false });
  const valid = title.trim().length >= 1 && title.trim().length <= 200;
  const create = async () => {
    if (!valid) return;
    close();
    await createNewDocument(title, profileId);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="New document"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Title" htmlFor="new-title" error={valid ? null : 'The title must be 1–200 characters'}>
          <Input id="new-title" autoFocus value={title} onFocus={(e) => e.target.select()} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Profile" htmlFor="new-profile">
          <Select id="new-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {allProfiles().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
