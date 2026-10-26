import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/commands/catalog.ts';
import {
  altGrBlocks,
  bindingKeyLabels,
  bindingsEqual,
  conflictsFor,
  eventToBinding,
  findConflicts,
  formatBinding,
  isReservedBinding,
  matchesEvent,
  normalizeBinding,
  validateBinding,
} from '../src/keybindings/index.ts';

const ev = (p: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...p,
});

describe('formatBinding', () => {
  it('formats for macOS with symbols in ⌃⌥⇧⌘ order', () => {
    expect(formatBinding('$mod+Shift+k', 'mac')).toBe('⇧⌘K');
    expect(formatBinding('$mod+Alt+Shift+m', 'mac')).toBe('⌥⇧⌘M');
    expect(formatBinding('Control+Alt+Digit1', 'mac')).toBe('⌃⌥1');
    expect(formatBinding('$mod+Enter', 'mac')).toBe('⌘↵');
    expect(formatBinding('$mod+Backslash', 'mac')).toBe('⌘\\');
  });
  it('formats for other platforms', () => {
    expect(formatBinding('$mod+Shift+k', 'other')).toBe('Ctrl+Shift+K');
    expect(formatBinding('$mod+Shift+Digit8', 'other')).toBe('Ctrl+Shift+8');
    expect(formatBinding('$mod+Enter', 'other')).toBe('Ctrl+Enter');
    expect(formatBinding('$mod+Comma', 'other')).toBe('Ctrl+,');
    expect(formatBinding('$mod+Shift+Semicolon', 'other')).toBe('Ctrl+Shift+;');
    expect(formatBinding('$mod+Period', 'other')).toBe('Ctrl+.');
    expect(formatBinding('$mod+Slash', 'other')).toBe('Ctrl+/');
    expect(formatBinding('F8', 'other')).toBe('F8');
    expect(formatBinding('Shift+F8', 'mac')).toBe('⇧F8');
  });
});

describe('bindingKeyLabels', () => {
  it('returns one label per key', () => {
    expect(bindingKeyLabels('$mod+Shift+k', 'mac')).toEqual(['⇧', '⌘', 'K']);
    expect(bindingKeyLabels('$mod+Shift+k', 'other')).toEqual(['Ctrl', 'Shift', 'K']);
    expect(bindingKeyLabels('$mod+Alt+Digit1', 'other')).toEqual(['Ctrl', 'Alt', '1']);
    expect(bindingKeyLabels('F8', 'mac')).toEqual(['F8']);
  });
});

describe('normalisation', () => {
  it('treats case and modifier order as equal', () => {
    expect(normalizeBinding('$mod+Shift+K')).toBe(normalizeBinding('$mod+shift+k'));
    expect(normalizeBinding('Shift+$mod+k')).toBe('$mod+Shift+k');
    expect(bindingsEqual('$mod+b', 'Meta+b', 'mac')).toBe(true);
    expect(bindingsEqual('$mod+b', 'Control+b', 'other')).toBe(true);
    expect(bindingsEqual('$mod+b', 'Control+b', 'mac')).toBe(false);
  });
  it('records events', () => {
    expect(eventToBinding(ev({ key: 'B', code: 'KeyB', metaKey: true, shiftKey: true }), 'mac')).toBe('$mod+Shift+b');
    expect(eventToBinding(ev({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true }), 'other')).toBe('$mod+Shift+Digit8');
    expect(eventToBinding(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), 'other')).toBeNull();
    expect(eventToBinding(ev({ key: 'F8', code: 'F8' }), 'other')).toBe('F8');
  });
  it('matches events', () => {
    expect(matchesEvent(ev({ key: 'b', code: 'KeyB', metaKey: true }), '$mod+b', 'mac')).toBe(true);
    expect(matchesEvent(ev({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true }), '$mod+Shift+Digit8', 'other')).toBe(true);
    expect(matchesEvent(ev({ key: 'b', code: 'KeyB', ctrlKey: true, shiftKey: true }), '$mod+b', 'other')).toBe(false);
  });
});

describe('conflicts', () => {
  it('detects global vs editor conflicts', () => {
    const c = findConflicts(
      [
        { id: 'a', scope: 'global', keys: ['$mod+k'] },
        { id: 'b', scope: 'editor', keys: ['$mod+K'] },
      ],
      'other',
    );
    expect(c).toHaveLength(1);
  });
  it('does not treat editor vs assetsTree as conflicting', () => {
    expect(
      findConflicts(
        [
          { id: 'a', scope: 'editor', keys: ['Enter'] },
          { id: 'b', scope: 'assetsTree', keys: ['Enter'] },
        ],
        'other',
      ),
    ).toEqual([]);
  });
  it('reports who uses a binding', () => {
    const entries = COMMANDS.map((c) => ({ id: c.id, scope: c.scope, keys: c.defaultKeys }));
    expect(conflictsFor('$mod+i', 'editor', 'format.bold', entries, 'other')).toEqual(['format.italic']);
  });
});

describe('validation', () => {
  it('rejects reserved combinations', () => {
    expect(isReservedBinding('$mod+w', 'other')).toBe(true);
    expect(isReservedBinding('$mod+q', 'mac')).toBe(true);
    expect(isReservedBinding('$mod+q', 'other')).toBe(false);
    expect(isReservedBinding('Alt+F4', 'other')).toBe(true);
    expect(validateBinding('$mod+Shift+Digit4', 'global', 'mac')).toMatch(/reserved/);
  });
  it('requires a modifier except for F-keys and the assets tree', () => {
    expect(validateBinding('k', 'editor', 'other')).not.toBeNull();
    expect(validateBinding('F9', 'editor', 'other')).toBeNull();
    expect(validateBinding('Shift+F9', 'global', 'other')).toBeNull();
    expect(validateBinding('m', 'assetsTree', 'other')).toBeNull();
    expect(validateBinding('$mod+Shift+u', 'editor', 'other')).toBeNull();
  });
});

describe('AltGr guard', () => {
  it('does not dispatch Ctrl+Alt+Digit7 producing {', () => {
    expect(altGrBlocks(ev({ key: '{', code: 'Digit7', ctrlKey: true, altKey: true }), '$mod+Alt+Digit7', 'other')).toBe(true);
  });
  it('dispatches Ctrl+Alt+Digit1 producing 1', () => {
    expect(altGrBlocks(ev({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true }), '$mod+Alt+Digit1', 'other')).toBe(false);
  });
  it('never blocks on macOS or for bindings without Ctrl+Alt', () => {
    expect(altGrBlocks(ev({ key: '¡', code: 'Digit1', metaKey: true, altKey: true }), '$mod+Alt+Digit1', 'mac')).toBe(false);
    expect(altGrBlocks(ev({ key: 'ą', code: 'KeyA', altKey: true }), 'Alt+a', 'other')).toBe(false);
  });
});

describe('catalog integrity', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('has no conflicting default bindings on either platform', () => {
    const entries = COMMANDS.map((c) => ({ id: c.id, scope: c.scope, keys: c.defaultKeys }));
    expect(findConflicts(entries, 'mac')).toEqual([]);
    expect(findConflicts(entries, 'other')).toEqual([]);
  });
  it('uses no reserved defaults and modifier-less keys only where allowed', () => {
    for (const c of COMMANDS) {
      for (const k of c.defaultKeys) {
        expect(isReservedBinding(k, 'mac'), `${c.id} ${k}`).toBe(false);
        expect(validateBinding(k, c.scope, 'other'), `${c.id} ${k}`).toBeNull();
      }
    }
  });
});
