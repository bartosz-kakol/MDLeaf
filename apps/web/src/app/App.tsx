import { Tooltip } from 'radix-ui';
import { CommandPalette } from '@/components/dialogs/CommandPalette.tsx';
import { ChooseMarkdownDialog, ConfirmDialog, PromptDialog, StorageFullDialog } from '@/components/dialogs/common.tsx';
import { NewDocumentDialog } from '@/components/dialogs/NewDocumentDialog.tsx';
import { SettingsDialog } from '@/components/settings/SettingsDialog.tsx';
import { Toaster } from '@/components/Toaster.tsx';
import { useRouteStore } from '@/state/stores.ts';
import { EditorScreen } from './EditorScreen.tsx';
import { Library } from './Library.tsx';

export function App() {
  const route = useRouteStore((s) => s.route);
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {route.name === 'library' ? <Library /> : <EditorScreen key={route.id} docId={route.id} />}
      <CommandPalette />
      <NewDocumentDialog />
      <SettingsDialog />
      <ConfirmDialog />
      <PromptDialog />
      <StorageFullDialog />
      <ChooseMarkdownDialog />
      <Toaster />
    </Tooltip.Provider>
  );
}
