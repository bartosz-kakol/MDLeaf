import { Tabs } from 'radix-ui';
import { type SettingsTab, useUiStore } from '@/state/ui.ts';
import { Dialog } from '../ui.tsx';
import { AboutTab } from './AboutTab.tsx';
import { GeneralTab } from './GeneralTab.tsx';
import { KeyboardTab } from './KeyboardTab.tsx';
import { ProfilesTab } from './ProfilesTab.tsx';
import { ThemesTab } from './ThemesTab.tsx';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'themes', label: 'Themes' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'about', label: 'About' },
];

export function SettingsDialog() {
  const tab = useUiStore((s) => s.settings);
  return (
    <Dialog
      open={!!tab}
      onOpenChange={(o) => !o && useUiStore.getState().set({ settings: null })}
      title="Settings"
      width="max-w-[960px] h-[min(720px,90vh)]"
    >
      {tab ? (
        <Tabs.Root
          value={tab}
          onValueChange={(v) => useUiStore.getState().set({ settings: v as SettingsTab })}
          orientation="vertical"
          className="flex h-full min-h-[420px] gap-4"
        >
          <Tabs.List aria-label="Settings sections" className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border pr-3">
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.id}
                value={t.id}
                className="rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-bg-hover data-[state=active]:bg-accent-soft data-[state=active]:font-medium data-[state=active]:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="min-w-0 flex-1 overflow-auto pr-1">
            <Tabs.Content value="general">
              <GeneralTab />
            </Tabs.Content>
            <Tabs.Content value="profiles">
              <ProfilesTab />
            </Tabs.Content>
            <Tabs.Content value="themes">
              <ThemesTab />
            </Tabs.Content>
            <Tabs.Content value="keyboard">
              <KeyboardTab />
            </Tabs.Content>
            <Tabs.Content value="about">
              <AboutTab />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      ) : null}
    </Dialog>
  );
}
