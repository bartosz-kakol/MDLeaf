import type { EditorView } from '@codemirror/view';
import { COMMANDS, type CommandSpec, findCommand } from '@mdleaf/core';
import { create } from 'zustand';
import { useSettingsStore } from '@/state/stores.ts';

export interface CommandContext {
  view: EditorView | null;
  docId: string | null;
  source: 'key' | 'button' | 'palette' | 'menu';
}

export interface Command extends CommandSpec {
  run(ctx: CommandContext): void | Promise<void>;
  isEnabled?(ctx: CommandContext): boolean;
  isChecked?(ctx: CommandContext): boolean;
}

const commands = new Map<string, Command>();

/** Bumped when commands are registered or when enabled/checked state may have changed. */
export const useCommandVersion = create<{ version: number; bump(): void }>((set, get) => ({
  version: 0,
  bump: () => set({ version: get().version + 1 }),
}));

let contextProvider: () => Omit<CommandContext, 'source'> = () => ({ view: null, docId: null });

export function setContextProvider(fn: () => Omit<CommandContext, 'source'>): void {
  contextProvider = fn;
}

export function currentContext(source: CommandContext['source']): CommandContext {
  return { ...contextProvider(), source };
}

export function registerCommand(c: Pick<Command, 'id' | 'run'> & Partial<Omit<Command, 'id' | 'run'>>): void {
  const spec = findCommand(c.id);
  if (!spec) throw new Error(`Unknown command ${c.id}`);
  commands.set(c.id, { ...spec, ...c } as Command);
  useCommandVersion.getState().bump();
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

export function allCommands(): Command[] {
  return COMMANDS.map((c) => commands.get(c.id)).filter((c): c is Command => !!c);
}

export function isEnabled(id: string, source: CommandContext['source'] = 'button'): boolean {
  const c = commands.get(id);
  if (!c) return false;
  return c.isEnabled ? c.isEnabled(currentContext(source)) : true;
}

export function isChecked(id: string): boolean {
  const c = commands.get(id);
  return !!c?.isChecked?.(currentContext('button'));
}

const RECENT_KEY = 'mdleaf:recentCommands';

export function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    const list = [id, ...recentCommands().filter((x) => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export async function runCommand(id: string, source: CommandContext['source']): Promise<void> {
  const c = commands.get(id);
  if (!c) return;
  const ctx = currentContext(source);
  if (c.isEnabled && !c.isEnabled(ctx)) return;
  if (source === 'palette') remember(id);
  try {
    await c.run(ctx);
  } finally {
    useCommandVersion.getState().bump();
  }
}

/** Defaults merged with the overrides from settings.keybindings. */
export function effectiveBindings(id: string): string[] {
  const overrides = useSettingsStore.getState().settings.keybindings;
  if (Object.hasOwn(overrides, id)) return overrides[id];
  return findCommand(id)?.defaultKeys ?? [];
}

export function useBindings(id: string): string[] {
  const overrides = useSettingsStore((s) => s.settings.keybindings);
  if (Object.hasOwn(overrides, id)) return overrides[id];
  return findCommand(id)?.defaultKeys ?? [];
}
