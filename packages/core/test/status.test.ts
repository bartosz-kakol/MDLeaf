import { describe, expect, it } from 'vitest';
import { describeExternalSession, type ExternalSession, parseExternalSession, parseStatusResponse } from '../src/index.ts';

const session: ExternalSession = { id: 'a', kind: 'mcp', client: 'Claude Code', action: 'paginate', document: 'report.md' };

describe('external status', () => {
  it('describes sessions', () => {
    expect(describeExternalSession(session)).toBe('Claude Code: paginating report.md');
    expect(describeExternalSession({ ...session, action: null, document: null })).toBe('Claude Code connected');
    expect(describeExternalSession({ ...session, client: null, action: null })).toBe('AI agent connected');
    expect(describeExternalSession({ ...session, kind: 'cli', client: null, action: 'lint', document: 'a.md' })).toBe(
      'Command line: checking a.md',
    );
  });

  it('accepts a valid response', () => {
    expect(parseStatusResponse({ sessions: [session] })).toEqual([session]);
    expect(parseStatusResponse({ sessions: [] })).toEqual([]);
  });

  it('rejects malformed input', () => {
    for (const bad of [null, 'x', {}, { sessions: 'x' }, { sessions: [{ id: 'a' }] }]) expect(parseStatusResponse(bad)).toBeNull();
    expect(parseExternalSession({ ...session, kind: 'browser' })).toBeNull();
    expect(parseExternalSession({ ...session, action: 'delete' })).toBeNull();
    expect(parseExternalSession({ ...session, action: 'toString' })).toBeNull();
    expect(parseExternalSession({ ...session, document: 'x'.repeat(513) })).toBeNull();
  });
});
