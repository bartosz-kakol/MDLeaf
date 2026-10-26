import type { CommandScope } from '../commands/catalog.ts';

/** Keybinding helpers. Bindings use tinykeys syntax. */

export type Platform = 'mac' | 'other';

export interface ParsedBinding {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Lowercase letter, an `event.code` name (`Digit8`, `Backslash`), or a key name (`Enter`, `F8`). */
  key: string;
}

const CODE_CHARS: Record<string, string> = {
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Slash: '/',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

const CODE_KEYS = new Set([...Object.keys(CODE_CHARS), ...Array.from({ length: 10 }, (_, i) => `Digit${i}`)]);

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  ' ': 'Space',
  tab: 'Tab',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  contextmenu: 'ContextMenu',
};

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  // Same test as tinykeys uses for `$mod`, so labels and behaviour always agree.
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '') ? 'mac' : 'other';
}

function normalizeKey(raw: string): string {
  if (raw.length === 1) {
    const lower = raw.toLowerCase();
    return KEY_ALIASES[lower] ?? lower;
  }
  const alias = KEY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (/^f([1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase();
  if (/^digit\d$/i.test(raw)) return `Digit${raw.slice(5)}`;
  if (/^key[a-z]$/i.test(raw)) return raw.slice(3).toLowerCase();
  for (const code of CODE_KEYS) if (code.toLowerCase() === raw.toLowerCase()) return code;
  return raw;
}

export function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.trim().split('+');
  if (parts.length === 0) return null;
  // "$mod++" style is not supported; a trailing empty part means "+".
  const keyRaw = parts.pop() ?? '';
  if (!keyRaw) return null;
  const b: ParsedBinding = { mod: false, ctrl: false, alt: false, shift: false, meta: false, key: normalizeKey(keyRaw) };
  for (const p of parts) {
    switch (p.toLowerCase()) {
      case '$mod':
        b.mod = true;
        break;
      case 'control':
      case 'ctrl':
        b.ctrl = true;
        break;
      case 'alt':
      case 'option':
        b.alt = true;
        break;
      case 'shift':
        b.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        b.meta = true;
        break;
      default:
        return null;
    }
  }
  return b;
}

/** Canonical tinykeys string: `$mod+Control+Alt+Shift+Meta+key`. */
export function normalizeBinding(binding: string): string {
  const b = parseBinding(binding);
  if (!b) return binding;
  return stringify(b);
}

function stringify(b: ParsedBinding): string {
  const parts: string[] = [];
  if (b.mod) parts.push('$mod');
  if (b.ctrl) parts.push('Control');
  if (b.alt) parts.push('Alt');
  if (b.shift) parts.push('Shift');
  if (b.meta) parts.push('Meta');
  parts.push(b.key);
  return parts.join('+');
}

/** Resolves `$mod` for a platform, for comparisons. */
export function resolvedKey(binding: string, platform: Platform): string {
  const b = parseBinding(binding);
  if (!b) return binding;
  const r: ParsedBinding = {
    ...b,
    mod: false,
    ctrl: b.ctrl || (b.mod && platform === 'other'),
    meta: b.meta || (b.mod && platform === 'mac'),
  };
  return stringify(r);
}

export function bindingsEqual(a: string, b: string, platform: Platform): boolean {
  return resolvedKey(a, platform) === resolvedKey(b, platform);
}

function keyLabel(key: string, platform: Platform): string {
  if (key.startsWith('Digit')) return key.slice(5);
  if (CODE_CHARS[key]) return CODE_CHARS[key];
  if (key.length === 1) return key.toUpperCase();
  const mac: Record<string, string> = {
    Enter: '↵',
    Backspace: '⌫',
    Delete: '⌦',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    Tab: '⇥',
  };
  const other: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
  };
  return (platform === 'mac' ? mac[key] : other[key]) ?? key;
}

/** One label per key, in platform order: `['⇧', '⌘', 'K']` on macOS, `['Ctrl', 'Shift', 'K']` elsewhere. */
export function bindingKeyLabels(binding: string, platform: Platform): string[] {
  const b = parseBinding(binding);
  if (!b) return [binding];
  const ctrl = b.ctrl || (b.mod && platform === 'other');
  const meta = b.meta || (b.mod && platform === 'mac');
  const parts: string[] = [];
  if (platform === 'mac') {
    if (ctrl) parts.push('⌃');
    if (b.alt) parts.push('⌥');
    if (b.shift) parts.push('⇧');
    if (meta) parts.push('⌘');
  } else {
    if (ctrl) parts.push('Ctrl');
    if (meta) parts.push('Win');
    if (b.alt) parts.push('Alt');
    if (b.shift) parts.push('Shift');
  }
  parts.push(keyLabel(b.key, platform));
  return parts;
}

/** Human-readable label: `⌘⇧K` on macOS, `Ctrl+Shift+K` elsewhere. */
export function formatBinding(binding: string, platform: Platform): string {
  return bindingKeyLabels(binding, platform).join(platform === 'mac' ? '' : '+');
}

/** Value for `aria-keyshortcuts`, e.g. `Meta+B`. */
export function ariaKeyshortcut(binding: string, platform: Platform): string {
  const b = parseBinding(binding);
  if (!b) return '';
  const parts: string[] = [];
  if (b.ctrl || (b.mod && platform === 'other')) parts.push('Control');
  if (b.alt) parts.push('Alt');
  if (b.shift) parts.push('Shift');
  if (b.meta || (b.mod && platform === 'mac')) parts.push('Meta');
  const key = b.key.startsWith('Digit') ? b.key.slice(5) : (CODE_CHARS[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key));
  parts.push(key);
  return parts.join('+');
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Hyper', 'Super', 'Fn']);

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Turns a recorded keydown into a binding string, or null for a bare modifier. */
export function eventToBinding(e: KeyEventLike, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string;
  if (CODE_KEYS.has(e.code)) key = e.code;
  else if (/^[a-z]$/i.test(e.key)) key = e.key.toLowerCase();
  else if (/^Key[A-Z]$/.test(e.code) && e.key.length === 1) key = e.code.slice(3).toLowerCase();
  else key = normalizeKey(e.key);
  const b: ParsedBinding = {
    mod: platform === 'mac' ? e.metaKey : e.ctrlKey,
    ctrl: platform === 'mac' ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: platform === 'mac' ? false : e.metaKey,
    key,
  };
  return stringify(b);
}

export function hasModifier(binding: string): boolean {
  const b = parseBinding(binding);
  return !!b && (b.mod || b.ctrl || b.alt || b.meta);
}

export function isFunctionKey(binding: string): boolean {
  const b = parseBinding(binding);
  return !!b && /^F([1-9]|1[0-2])$/.test(b.key);
}

const RESERVED_ALL = [
  '$mod+w',
  '$mod+t',
  '$mod+n',
  '$mod+Shift+n',
  '$mod+Shift+t',
  '$mod+Shift+w',
  '$mod+Tab',
  '$mod+Shift+Tab',
  'Control+Tab',
  'Alt+F4',
];
const RESERVED_MAC = ['$mod+q', '$mod+h', '$mod+m', '$mod+Space', '$mod+Shift+Digit3', '$mod+Shift+Digit4', '$mod+Shift+Digit5'];

export function isReservedBinding(binding: string, platform: Platform): boolean {
  const list = platform === 'mac' ? [...RESERVED_ALL, ...RESERVED_MAC] : RESERVED_ALL;
  return list.some((r) => bindingsEqual(r, binding, platform));
}

export const RESERVED_MESSAGE = 'This shortcut is reserved by the browser or operating system';

/** Validates a recorded binding for a command scope; returns an error message or null. */
export function validateBinding(binding: string, scope: CommandScope, platform: Platform): string | null {
  if (!parseBinding(binding)) return 'This is not a valid shortcut';
  if (isReservedBinding(binding, platform)) return RESERVED_MESSAGE;
  if (!hasModifier(binding) && !isFunctionKey(binding) && scope !== 'assetsTree') {
    const b = parseBinding(binding)!;
    // Shift alone is not a modifier for this rule (Shift+F8 is a function key).
    if (!(b.shift && isFunctionKey(binding))) return 'Add at least one modifier (Ctrl, Alt, ⌘ …), or use F1–F12';
  }
  return null;
}

export function scopesOverlap(a: CommandScope, b: CommandScope): boolean {
  return a === 'global' || b === 'global' || a === b;
}

export interface BindingEntry {
  id: string;
  scope: CommandScope;
  keys: string[];
}

export interface Conflict {
  binding: string;
  a: string;
  b: string;
}

export function findConflicts(entries: BindingEntry[], platform: Platform): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (!scopesOverlap(a.scope, b.scope)) continue;
      for (const ka of a.keys) {
        for (const kb of b.keys) {
          if (bindingsEqual(ka, kb, platform)) out.push({ binding: ka, a: a.id, b: b.id });
        }
      }
    }
  }
  return out;
}

/** Commands (other than `exceptId`) that already use `binding` in an overlapping scope. */
export function conflictsFor(
  binding: string,
  scope: CommandScope,
  exceptId: string,
  entries: BindingEntry[],
  platform: Platform,
): string[] {
  return entries
    .filter((e) => e.id !== exceptId && scopesOverlap(scope, e.scope) && e.keys.some((k) => bindingsEqual(k, binding, platform)))
    .map((e) => e.id);
}

/** The character a binding's key is expected to produce. */
export function expectedChar(binding: string): string | null {
  const b = parseBinding(binding);
  if (!b) return null;
  if (b.key.startsWith('Digit')) return b.key.slice(5);
  if (CODE_CHARS[b.key]) return CODE_CHARS[b.key];
  if (b.key.length === 1) return b.key;
  return null;
}

/**
 * AltGr guard: Windows reports AltGr as Ctrl+Alt. For a binding that
 * uses both Ctrl and Alt, skip dispatch when the event produced a different
 * single character than the binding expects.
 */
export function altGrBlocks(e: KeyEventLike, binding: string, platform: Platform): boolean {
  if (platform === 'mac') return false;
  const b = parseBinding(binding);
  if (!b) return false;
  const ctrl = b.ctrl || b.mod;
  if (!(ctrl && b.alt)) return false;
  if (e.key.length !== 1) return false;
  const expected = expectedChar(binding);
  if (expected === null) return true;
  return e.key.toLowerCase() !== expected.toLowerCase();
}

/** True when a keyboard event matches a binding (tinykeys semantics). */
export function matchesEvent(e: KeyEventLike, binding: string, platform: Platform): boolean {
  const b = parseBinding(binding);
  if (!b) return false;
  const ctrl = b.ctrl || (b.mod && platform === 'other');
  const meta = b.meta || (b.mod && platform === 'mac');
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== b.alt || e.shiftKey !== b.shift) return false;
  if (b.key.startsWith('Digit') || CODE_CHARS[b.key]) return e.code === b.key;
  if (b.key.length === 1) return e.key.toLowerCase() === b.key || e.code === `Key${b.key.toUpperCase()}`;
  if (b.key === 'Space') return e.code === 'Space' || e.key === ' ';
  return e.key.toLowerCase() === b.key.toLowerCase() || e.code === b.key;
}
