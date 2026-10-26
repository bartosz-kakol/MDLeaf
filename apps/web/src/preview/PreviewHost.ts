import type { EffectiveProfile, HostMessage, PreviewMessage, RenderedMessage, Zoom } from '@mdleaf/core';

export interface RenderInput {
  markdown: string;
  docTitle: string;
  profile: EffectiveProfile;
  themeCss: string;
  assetUrls: Record<string, string>;
  zoom: Zoom;
}

export interface PreviewHostEvents {
  onRendered(msg: RenderedMessage): void;
  onPageState(state: 'idle' | 'pending' | 'running' | 'error', error?: string): void;
  onLink(href: string): void;
  onKey(msg: Extract<PreviewMessage, { type: 'key' }>): void;
  onAfterPrint(): void;
  /** Called right before a render message is sent (for source-position mapping). */
  onRenderStart(renderId: number): void;
}

interface Frame {
  el: HTMLIFrameElement;
  ready: boolean;
  queue: HostMessage[];
  waiters: Map<number, { resolve(m: RenderedMessage): void; reject(e: Error): void }>;
}

const PAGE_TIMEOUT_MS = 30_000;
const DRAFT_DEBOUNCE = 150;
const PAGE_DEBOUNCE = 600;

let nextRenderId = 1;

function sameInput(a: RenderInput | null, b: RenderInput | null): boolean {
  if (!a || !b) return false;
  return (
    a.markdown === b.markdown &&
    a.docTitle === b.docTitle &&
    a.themeCss === b.themeCss &&
    JSON.stringify(a.profile) === JSON.stringify(b.profile) &&
    JSON.stringify(a.assetUrls) === JSON.stringify(b.assetUrls)
  );
}

/**
 * Owns the preview iframes: one persistent draft iframe and two
 * page iframes used as a double buffer, each pagination running in a freshly
 * loaded document.
 */
export class PreviewHost {
  private container: HTMLElement | null = null;
  private draft: Frame | null = null;
  private pages: [Frame, Frame] | null = null;
  private visiblePage = 0;
  private mode: 'draft' | 'page' = 'draft';
  private latest: RenderInput | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private pageTimer: ReturnType<typeof setTimeout> | null = null;
  private pageRunning = false;
  private pagePending = false;
  private lastPaginated: RenderInput | null = null;
  private anchor: { line: number; fraction: number } | null = null;
  private zoom: Zoom = 'fit';
  private pageWaiters: Array<() => void> = [];
  private disposed = false;
  scrollFollow = true;

  constructor(private events: PreviewHostEvents) {
    window.addEventListener('message', this.onMessage);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    if (this.pageTimer) clearTimeout(this.pageTimer);
    this.container?.replaceChildren();
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.replaceChildren();
    const make = (cls: string, src: string): Frame => {
      const el = document.createElement('iframe');
      el.className = cls;
      el.title = 'Document preview';
      el.src = src;
      container.appendChild(el);
      return { el, ready: false, queue: [], waiters: new Map() };
    };
    this.draft = make('mdl-preview-frame', '/preview.html?mode=draft');
    this.pages = [make('mdl-preview-frame', 'about:blank'), make('mdl-preview-frame', 'about:blank')];
    this.applyVisibility();
  }

  private frameOf(source: MessageEventSource | null): Frame | null {
    for (const f of [this.draft, ...(this.pages ?? [])]) if (f && f.el.contentWindow === source) return f;
    return null;
  }

  private onMessage = (e: MessageEvent): void => {
    if (e.origin !== location.origin) return;
    const frame = this.frameOf(e.source);
    if (!frame) return;
    const msg = e.data as PreviewMessage;
    switch (msg.type) {
      case 'ready':
        frame.ready = true;
        for (const m of frame.queue.splice(0)) this.post(frame, m);
        break;
      case 'rendered': {
        const w = frame.waiters.get(msg.renderId);
        frame.waiters.delete(msg.renderId);
        w?.resolve(msg);
        break;
      }
      case 'render-error': {
        const w = frame.waiters.get(msg.renderId);
        frame.waiters.delete(msg.renderId);
        w?.reject(new Error(msg.message));
        break;
      }
      case 'link':
        this.events.onLink(msg.href);
        break;
      case 'key':
        this.events.onKey(msg);
        break;
      case 'afterprint':
        this.events.onAfterPrint();
        break;
    }
  };

  private post(frame: Frame, msg: HostMessage): void {
    if (!frame.ready) {
      // Keep only the newest scroll/zoom while waiting.
      if (msg.type !== 'render') frame.queue = frame.queue.filter((q) => q.type !== msg.type);
      frame.queue.push(msg);
      return;
    }
    frame.el.contentWindow?.postMessage(msg, location.origin);
  }

  private renderIn(frame: Frame, input: RenderInput, mode: 'draft' | 'page'): Promise<RenderedMessage> {
    const renderId = nextRenderId++;
    this.events.onRenderStart(renderId);
    return new Promise((resolve, reject) => {
      frame.waiters.set(renderId, { resolve, reject });
      if (this.anchor && mode === 'page')
        this.post(frame, { type: 'scroll', line: this.anchor.line, fraction: this.anchor.fraction, animate: false });
      this.post(frame, { type: 'render', renderId, mode, ...input, zoom: this.zoom });
    });
  }

  private applyVisibility(): void {
    if (!this.draft || !this.pages) return;
    const show = (f: Frame, visible: boolean) => {
      f.el.style.visibility = visible ? 'visible' : 'hidden';
      f.el.style.zIndex = visible ? '1' : '0';
      f.el.tabIndex = visible ? 0 : -1;
      f.el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    };
    show(this.draft, this.mode === 'draft');
    show(this.pages[0], this.mode === 'page' && this.visiblePage === 0);
    show(this.pages[1], this.mode === 'page' && this.visiblePage === 1);
  }

  setMode(mode: 'draft' | 'page'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyVisibility();
    if (this.latest) {
      if (mode === 'page') this.schedulePage(0);
      else this.scheduleDraft(0);
    }
  }

  getMode(): 'draft' | 'page' {
    return this.mode;
  }

  /** Called on every content/profile/theme change. */
  update(input: RenderInput, opts: { immediate?: boolean } = {}): void {
    this.latest = input;
    if (this.mode === 'draft') this.scheduleDraft(opts.immediate ? 0 : DRAFT_DEBOUNCE);
    else this.schedulePage(opts.immediate ? 0 : PAGE_DEBOUNCE);
  }

  private scheduleDraft(delay: number): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      if (!this.latest || !this.draft || this.disposed) return;
      this.renderIn(this.draft, this.latest, 'draft')
        .then((m) => this.events.onRendered(m))
        .catch(() => undefined);
    }, delay);
  }

  private schedulePage(delay: number): void {
    if (this.pageTimer) clearTimeout(this.pageTimer);
    this.events.onPageState(this.pageRunning ? 'running' : 'pending');
    this.pageTimer = setTimeout(() => {
      this.pageTimer = null;
      if (this.pageRunning) {
        this.pagePending = true;
        return;
      }
      void this.paginate();
    }, delay);
  }

  /** True when the visible pages reflect the latest input. */
  isPageCurrent(): boolean {
    return sameInput(this.lastPaginated, this.latest) && !this.pageRunning && !this.pagePending && !this.pageTimer;
  }

  private loadFresh(frame: Frame): Promise<void> {
    return new Promise((resolve) => {
      frame.ready = false;
      frame.queue = [];
      for (const w of frame.waiters.values()) w.reject(new Error('Superseded'));
      frame.waiters.clear();
      const onLoad = () => {
        frame.el.removeEventListener('load', onLoad);
        resolve();
      };
      frame.el.addEventListener('load', onLoad);
      frame.el.src = `/preview.html?mode=page&r=${nextRenderId}`;
    });
  }

  private async paginate(): Promise<void> {
    if (!this.pages || !this.latest || this.disposed) return;
    const input = this.latest;
    this.pageRunning = true;
    this.pagePending = false;
    this.events.onPageState('running');
    const target = this.pages[1 - this.visiblePage];
    const prevFrame = this.pages[this.visiblePage];
    const prevScroll = prevFrame.el.contentWindow?.scrollY ?? 0;
    try {
      await this.loadFresh(target);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Pagination took longer than 30 seconds')), PAGE_TIMEOUT_MS);
      });
      const msg = await Promise.race([this.renderIn(target, input, 'page'), timeout]).finally(() => clearTimeout(timer));
      if (this.disposed) return;
      this.visiblePage = 1 - this.visiblePage;
      this.applyVisibility();
      if (!this.scrollFollow || !this.anchor) target.el.contentWindow?.scrollTo(0, prevScroll);
      prevFrame.el.src = 'about:blank';
      prevFrame.ready = false;
      this.lastPaginated = input;
      this.events.onRendered(msg);
      this.events.onPageState(this.pagePending ? 'pending' : 'idle');
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Superseded')) {
        this.events.onPageState('error', err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.pageRunning = false;
      if (this.pagePending && !this.disposed) void this.paginate();
      else {
        const waiters = this.pageWaiters.splice(0);
        for (const w of waiters) w();
      }
    }
  }

  retry(): void {
    if (this.mode === 'page') this.schedulePage(0);
  }

  /** Paginates (if needed) and resolves with the page iframe to print. */
  async preparePrint(input: RenderInput): Promise<HTMLIFrameElement> {
    this.latest = input;
    if (!this.isPageCurrent()) {
      await new Promise<void>((resolve) => {
        this.pageWaiters.push(resolve);
        if (!this.pageRunning) {
          if (this.pageTimer) clearTimeout(this.pageTimer);
          this.pageTimer = null;
          void this.paginate();
        } else this.pagePending = true;
      });
    }
    if (!this.pages || !this.lastPaginated) throw new Error('Page view failed');
    return this.pages[this.visiblePage].el;
  }

  scroll(line: number, fraction: number, animate: boolean): void {
    this.anchor = { line, fraction };
    const frame = this.mode === 'draft' ? this.draft : this.pages?.[this.visiblePage];
    if (frame) this.post(frame, { type: 'scroll', line, fraction, animate });
  }

  setZoom(zoom: Zoom): void {
    this.zoom = zoom;
    const frame = this.pages?.[this.visiblePage];
    if (frame) this.post(frame, { type: 'zoom', zoom });
  }

  visibleFrame(): HTMLIFrameElement | null {
    return (this.mode === 'draft' ? this.draft : this.pages?.[this.visiblePage])?.el ?? null;
  }
}
