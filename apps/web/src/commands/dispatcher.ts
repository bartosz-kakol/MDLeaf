import { altGrBlocks, COMMANDS, type KeyEventLike, matchesEvent } from '@mdleaf/core';
import { tinykeys } from 'tinykeys';
import { useKeybindingStore, useSettingsStore } from '@/state/stores.ts';
import { anyModalOpen } from '@/state/ui.ts';
import { effectiveBindings, getCommand, runCommand } from './registry.ts';

/*
 * One tinykeys map on window, keydown, capture phase, so app
 * shortcuts run before CodeMirror's keymaps.
 */

const TEXT_INPUT_CATEGORIES = new Set(['File', 'View', 'Navigate', 'Document', 'App']);

let unbind: (() => void) | null = null;
let suspended = 0;

/** Suspends dispatch (e.g. while recording a new shortcut). */
export function suspendDispatcher(): () => void {
  suspended++;
  return () => {
    suspended--;
  };
}

function inEditor(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.cm-editor');
}

function inTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (inEditor(target)) return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

function inAssetsTree(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-region="assets-tree"]');
}

/**
 * Decides whether a command may run for this event. Nothing runs while a
 * modal is open; asset-tree commands run only with focus in the tree; in a
 * text input other than the editor only File, View, Navigate, Document and
 * App commands run, so typing there is never swallowed.
 */
export function shouldDispatch(
  id: string,
  e: KeyEventLike & { target?: EventTarget | null },
  binding: string,
  fromPreview = false,
): boolean {
  if (suspended > 0) return false;
  const cmd = getCommand(id);
  if (!cmd) return false;
  if (anyModalOpen()) return false;
  const platform = useKeybindingStore.getState().platform;
  if (altGrBlocks(e, binding, platform)) return false;
  const target = fromPreview ? null : (e.target ?? null);
  if (cmd.scope === 'assetsTree') return inAssetsTree(target) && !inTextInput(target);
  if (inAssetsTree(target) && !inTextInput(target)) {
    // Keys like Enter/Delete belong to the tree there; modifiers still work.
    if (!/[$]mod|Control|Alt|Meta|^F\d/.test(binding)) return false;
  }
  if (inTextInput(target) && !TEXT_INPUT_CATEGORIES.has(cmd.category)) return false;
  return true;
}

export function bindDispatcher(): void {
  unbind?.();
  const map: Record<string, (e: KeyboardEvent) => void> = {};
  for (const spec of COMMANDS) {
    for (const binding of effectiveBindings(spec.id)) {
      const prev = map[binding];
      map[binding] = (e: KeyboardEvent) => {
        if (!shouldDispatch(spec.id, e, binding)) {
          prev?.(e);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        void runCommand(spec.id, 'key');
      };
    }
  }
  unbind = tinykeys(window, map, { event: 'keydown', capture: true });
}

/** Feeds a keydown forwarded from the preview iframe into the same matching. */
export function dispatchForwardedKey(e: KeyEventLike): void {
  const platform = useKeybindingStore.getState().platform;
  for (const spec of COMMANDS) {
    for (const binding of effectiveBindings(spec.id)) {
      if (matchesEvent(e, binding, platform) && shouldDispatch(spec.id, { ...e, target: null }, binding, true)) {
        if (spec.scope === 'assetsTree') continue;
        void runCommand(spec.id, 'key');
        return;
      }
    }
  }
}

/** Rebinds whenever the keybinding overrides change. */
export function initDispatcher(): void {
  bindDispatcher();
  let last = useSettingsStore.getState().settings.keybindings;
  useSettingsStore.subscribe((s) => {
    if (s.settings.keybindings !== last) {
      last = s.settings.keybindings;
      bindDispatcher();
    }
  });
}
