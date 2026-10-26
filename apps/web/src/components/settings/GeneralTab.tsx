import { defaultSettings } from '@mdleaf/core';
import { setPreviewScrollFollow } from '@/services/session.ts';
import { allProfiles, toast, useProfileStore, useSettingsStore } from '@/state/stores.ts';
import { Button, Field, Input, Select, Switch } from '../ui.tsx';

export function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings);
  useProfileStore((s) => s.userProfiles);
  const update = useSettingsStore.getState().update;
  return (
    <div className="max-w-md">
      <h3 className="mb-3 text-[14px] font-semibold">General</h3>
      <Field label="Default profile for new documents" htmlFor="gen-profile">
        <Select
          id="gen-profile"
          value={settings.defaultProfileId}
          onChange={(e) =>
            update((s) => {
              s.defaultProfileId = e.target.value;
            })
          }
        >
          {allProfiles().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Editor font size (12–24 px)" htmlFor="gen-font">
        <Input
          id="gen-font"
          type="number"
          min={12}
          max={24}
          className="w-24"
          value={settings.editor.fontSizePx}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n))
              update((s) => {
                s.editor.fontSizePx = Math.min(24, Math.max(12, Math.round(n)));
              });
          }}
        />
      </Field>
      <Switch
        label="Line wrapping"
        checked={settings.editor.lineWrapping}
        onChange={(v) =>
          update((s) => {
            s.editor.lineWrapping = v;
          })
        }
      />
      <Switch
        label="Scroll follow on by default"
        checked={settings.view.scrollSync}
        onChange={(v) => {
          update((s) => {
            s.view.scrollSync = v;
          });
          setPreviewScrollFollow(v);
        }}
      />
      <div className="mt-4">
        <Button
          onClick={() => {
            update((s) => {
              s.imageDialog = defaultSettings(navigator.language).imageDialog;
            });
            toast('Image dialog defaults were reset.');
          }}
        >
          Reset image dialog defaults
        </Button>
      </div>
    </div>
  );
}
