/*
 * The status the `mdleaf` CLI and MCP server publish on 127.0.0.1 so the app
 * can show that they are in use. One process owns the port and merges the
 * reports of the others.
 *
 * The port also appears in the app's Content-Security-Policy
 * (apps/web/vite.config.ts and apps/web/public/_headers).
 */
export const STATUS_PORT = 47821;
export const STATUS_HOST = '127.0.0.1';
export const STATUS_PATH = '/status';
export const STATUS_REPORT_PATH = '/report';
export const STATUS_URL = `http://${STATUS_HOST}:${STATUS_PORT}${STATUS_PATH}`;

/** The only web origin allowed to read the status, unless `MDLEAF_APP_ORIGIN` adds others. */
export const STATUS_APP_ORIGIN = 'https://mdleaf.app';

export type ExternalAction = 'lint' | 'outline' | 'paginate' | 'pdf';

export interface ExternalSession {
  id: string;
  kind: 'cli' | 'mcp';
  /** The name the MCP client gave in its handshake. */
  client: string | null;
  action: ExternalAction | null;
  /** File or folder name, never a full path. */
  document: string | null;
}

const ACTION_VERBS: Record<ExternalAction, string> = {
  lint: 'checking',
  outline: 'reading',
  paginate: 'paginating',
  pdf: 'exporting',
};

const MAX_TEXT = 512;
const MAX_SESSIONS = 64;

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
const optionalText = (v: unknown): v is string | null => v === null || text(v);

export function parseExternalSession(raw: unknown): ExternalSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, kind, client, action, document } = raw as Record<string, unknown>;
  if (!text(id) || (kind !== 'cli' && kind !== 'mcp') || !optionalText(client) || !optionalText(document)) return null;
  if (action !== null && !(typeof action === 'string' && Object.hasOwn(ACTION_VERBS, action))) return null;
  return { id, kind, client, action: action as ExternalAction | null, document };
}

/** Reads a `/status` response; null when it is not one. */
export function parseStatusResponse(raw: unknown): ExternalSession[] | null {
  const sessions = (raw as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(sessions) || sessions.length > MAX_SESSIONS) return null;
  const parsed = sessions.map(parseExternalSession);
  return parsed.every((s) => s !== null) ? (parsed as ExternalSession[]) : null;
}

/** One line for the status bar, such as "Claude Code: paginating report.md". */
export function describeExternalSession(s: ExternalSession): string {
  const who = s.kind === 'mcp' ? (s.client ?? 'AI agent') : 'Command line';
  if (!s.action) return `${who} connected`;
  return `${who}: ${ACTION_VERBS[s.action]}${s.document ? ` ${s.document}` : ''}`;
}
