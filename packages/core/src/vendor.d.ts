declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';

  const plugin: PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';

  const plugin: PluginSimple;
  export default plugin;
}

declare module '*.css?raw' {
  const css: string;
  export default css;
}

declare module 'pagedjs' {
  export class Handler {
    constructor(chunker: unknown, polisher: unknown, caller: unknown);
    chunker: unknown;
    polisher: unknown;
  }
  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content: DocumentFragment | HTMLElement,
      stylesheets: Array<string | Record<string, string>>,
      renderTo: HTMLElement,
    ): Promise<{ total: number; performance: number; pages: unknown[] }>;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
  export function registerHandlers(...handlers: unknown[]): void;
  export const registeredHandlers: unknown[];
}

declare module '*.css';
