import type { AssetFile, AssetNode, DocMeta, ProfileOverrides } from '../types.ts';
import { type ExternalSession, parseExternalSession, STATUS_HOST, STATUS_PORT } from './status.ts';

/*
 * The live connection between the app and the MDLeaf MCP server. A folder with
 * a `.mdleaf.json` is a workspace while an agent with the MCP server runs in
 * it: the app lists it, reads and writes its files through this connection and
 * keeps nothing of it in browser storage.
 *
 * The port also appears in the app's Content-Security-Policy
 * (apps/web/vite.config.ts and apps/web/public/_headers).
 */
export const WORKSPACE_FILE = '.mdleaf.json';
export const LIVE_PATH = '/live';
export const BRIDGE_PATH = '/bridge';
export const LOCK_PATH = '/lock';
export const UNLOCK_PATH = '/unlock';

export const localOrigin = (port: number = STATUS_PORT): string => `http://${STATUS_HOST}:${port}`;
export const liveUrl = (port: number = STATUS_PORT): string => `ws://${STATUS_HOST}:${port}${LIVE_PATH}`;
export const bridgeUrl = (port: number = STATUS_PORT): string => `${localOrigin(port)}${BRIDGE_PATH}`;

/** Document ids of workspaces, which the storage client routes to this connection. No `:`, so ids stay URL-safe. */
export const AGENT_DOC_PREFIX = 'agent-';
export const isAgentDocId = (id: unknown): id is string => typeof id === 'string' && id.startsWith(AGENT_DOC_PREFIX);

/** What `.mdleaf.json` holds: the document data that would otherwise live in browser storage. */
export interface WorkspaceFile {
  schemaVersion: 1;
  title: string;
  /** A file name directly inside the folder. */
  markdownFile: string;
  profileId: string;
  overrides: ProfileOverrides;
  viewMode: 'draft' | 'page';
  createdAt: string;
}

const isPlainMarkdownName = (v: unknown): v is string =>
  typeof v === 'string' && /\.(md|markdown)$/i.test(v) && !/[/\\]/.test(v) && !v.startsWith('.');

/** Reads a parsed `.mdleaf.json`, filling in optional fields; null when it cannot be used. */
export function parseWorkspaceFile(raw: unknown): WorkspaceFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<WorkspaceFile>;
  // The app can read and write this file through the connection, so it must never name something outside the folder.
  if (!isPlainMarkdownName(r.markdownFile) || typeof r.title !== 'string') return null;
  return {
    schemaVersion: 1,
    title: r.title,
    markdownFile: r.markdownFile,
    profileId: typeof r.profileId === 'string' ? r.profileId : 'builtin:default-a4',
    overrides: r.overrides && typeof r.overrides === 'object' ? r.overrides : {},
    viewMode: r.viewMode === 'page' ? 'page' : 'draft',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
  };
}

export interface WorkspaceLock {
  /** The MCP client holding the lock. */
  client: string | null;
  since: string;
  /** What the agent said it is about to do. */
  note: string | null;
}

export interface WorkspaceInfo {
  id: string;
  title: string;
  folderName: string;
  /** The agents running in this folder. */
  clients: string[];
  profileId: string;
  updatedAt: string;
  sizeBytes: number;
  lock: WorkspaceLock | null;
}

/** The calls the app makes; asset bytes travel as base64 because a bridge window relays text. */
export interface LiveMethods {
  readDocument: { params: { id: string }; result: { meta: DocMeta; markdown: string } };
  writeMarkdown: { params: { id: string; markdown: string }; result: { updatedAt: string } };
  updateMeta: { params: { id: string; patch: unknown }; result: DocMeta };
  listAssets: { params: { id: string }; result: AssetNode };
  readAsset: { params: { id: string; path: string }; result: { base64: string; type: string; name: string; lastModified: number } };
  writeAsset: { params: { id: string; path: string; base64: string; overwrite: boolean }; result: AssetFile };
  createFolder: { params: { id: string; path: string }; result: null };
  moveAsset: { params: { id: string; from: string; to: string }; result: null };
  deleteAssets: { params: { id: string; paths: string[] }; result: null };
  forceUnlock: { params: { id: string }; result: null };
}

export type LiveMethod = keyof LiveMethods;

/** Uses the storage error codes of the app. */
export interface LiveError {
  code: 'NOT_FOUND' | 'EXISTS' | 'INVALID_PATH' | 'LOCKED' | 'IO';
  message: string;
}

export type LiveClientMessage =
  | { type: 'request'; id: number; method: LiveMethod; params: unknown }
  /** The app has saved what it had: the answer to `flush`. */
  | { type: 'flushed'; requestId: number };

export type LiveServerMessage =
  | { type: 'state'; sessions: ExternalSession[]; workspaces: WorkspaceInfo[] }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: LiveError }
  /** The file changed: `markdown` is its whole new text. */
  | { type: 'doc-changed'; workspace: string; markdown: string; updatedAt: string }
  | { type: 'meta-changed'; workspace: string; meta: DocMeta }
  | { type: 'assets-changed'; workspace: string }
  /** An agent is about to lock: save now and stop editing. */
  | { type: 'flush'; requestId: number; workspace: string };

const isText = (v: unknown): v is string => typeof v === 'string';

function parseWorkspaceInfo(raw: unknown): WorkspaceInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as WorkspaceInfo;
  if (!isAgentDocId(w.id) || !isText(w.title) || !isText(w.folderName) || !Array.isArray(w.clients)) return null;
  return w;
}

/** Validates what comes off the socket; null for anything the app does not understand. */
export function parseLiveServerMessage(text: string): LiveServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as LiveServerMessage;
  switch (msg.type) {
    case 'state': {
      if (!Array.isArray(msg.sessions) || !Array.isArray(msg.workspaces)) return null;
      const sessions = msg.sessions.map(parseExternalSession);
      const workspaces = msg.workspaces.map(parseWorkspaceInfo);
      if (sessions.some((s) => !s) || workspaces.some((w) => !w)) return null;
      return { type: 'state', sessions: sessions as ExternalSession[], workspaces: workspaces as WorkspaceInfo[] };
    }
    case 'response':
      return typeof msg.id === 'number' ? msg : null;
    case 'doc-changed':
      return isText(msg.workspace) && isText(msg.markdown) ? msg : null;
    case 'meta-changed':
      return isText(msg.workspace) && msg.meta && typeof msg.meta === 'object' ? msg : null;
    case 'assets-changed':
      return isText(msg.workspace) ? msg : null;
    case 'flush':
      return typeof msg.requestId === 'number' && isText(msg.workspace) ? msg : null;
    default:
      return null;
  }
}

/** The smallest single replacement turning `from` into `to`; null when they are equal. Never splits a surrogate pair. */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  const max = Math.min(from.length, to.length);
  let start = 0;
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(from.charCodeAt(start - 1))) start--;
  let end = 0;
  while (end < max - start && from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)) end++;
  if (end > 0 && isLowSurrogate(from.charCodeAt(from.length - end))) end--;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;
