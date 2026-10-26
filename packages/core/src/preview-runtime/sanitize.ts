import DOMPurify from 'dompurify';

export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: [
    'data-src-line',
    'data-src-line-end',
    'data-src-path',
    'data-align',
    'data-mdl-kind',
    'data-slot-left',
    'data-slot-center',
    'data-slot-right',
    'data-hide-header',
    'data-hide-footer',
    'data-start',
    'data-offset',
    'data-target',
    'aria-hidden',
    'aria-label',
    'aria-level',
    'role',
    'download',
  ],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcset'],
  ALLOWED_URI_REGEXP: /^(?:https?:|blob:|data:image\/|#|mailto:)/i,
};

/** Sanitises rendered HTML with `SANITIZE_CONFIG`. */
export function sanitizeHtml(html: string, win?: Window): string {
  const purify = win ? DOMPurify(win as never) : DOMPurify;
  return purify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}
