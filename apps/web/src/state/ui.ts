import { create } from 'zustand';

export type SettingsTab = 'general' | 'profiles' | 'themes' | 'keyboard' | 'about';
export type PopoverKind = 'headingLink' | 'header' | 'footer' | 'hide' | 'pageNumber';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Extra buttons; the promise resolves with their id. */
  extra?: Array<{ id: string; label: string }>;
  details?: string[];
  resolve(result: 'confirm' | 'cancel' | string): void;
}

export interface PromptRequest {
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  /** Fixed suffix shown after the input (file extensions). */
  suffix?: string;
  validate?(value: string): string | null;
  resolve(value: string | null): void;
}

export interface ImageJob {
  file: File;
  /** Insertion range in the editor at the time of paste/drop. */
  from: number;
  to: number;
  folder?: string;
  index: number;
  total: number;
}

export interface UiState {
  palette: null | 'commands' | 'documents';
  settings: SettingsTab | null;
  docSettings: boolean;
  gotoLine: boolean;
  imagePicker: boolean;
  newDocument: boolean;
  shortcutsHelp: boolean;
  moveAsset: string | null;
  popover: PopoverKind | null;
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  imageJobs: ImageJob[];
  pdf: null | { stage: 'preparing' | 'ready'; problems: number };
  storageFull: boolean;
  chooseMarkdown: null | { files: string[]; resolve(name: string | null): void };
  set(p: Partial<Omit<UiState, 'set'>>): void;
}

export const useUiStore = create<UiState>((set) => ({
  palette: null,
  settings: null,
  docSettings: false,
  gotoLine: false,
  imagePicker: false,
  newDocument: false,
  shortcutsHelp: false,
  moveAsset: null,
  popover: null,
  confirm: null,
  prompt: null,
  imageJobs: [],
  pdf: null,
  storageFull: false,
  chooseMarkdown: null,
  set: (p) => set(p),
}));

export function anyModalOpen(): boolean {
  const s = useUiStore.getState();
  return !!(
    s.palette ||
    s.settings ||
    s.docSettings ||
    s.gotoLine ||
    s.imagePicker ||
    s.newDocument ||
    s.shortcutsHelp ||
    s.moveAsset ||
    s.popover ||
    s.confirm ||
    s.prompt ||
    s.imageJobs.length ||
    s.pdf ||
    s.storageFull ||
    s.chooseMarkdown
  );
}

export function confirmDialog(req: Omit<ConfirmRequest, 'resolve'>): Promise<'confirm' | 'cancel' | string> {
  return new Promise((resolve) => {
    useUiStore.getState().set({
      confirm: {
        ...req,
        resolve: (r) => {
          useUiStore.getState().set({ confirm: null });
          resolve(r);
        },
      },
    });
  });
}

export function promptDialog(req: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useUiStore.getState().set({
      prompt: {
        ...req,
        resolve: (v) => {
          useUiStore.getState().set({ prompt: null });
          resolve(v);
        },
      },
    });
  });
}
