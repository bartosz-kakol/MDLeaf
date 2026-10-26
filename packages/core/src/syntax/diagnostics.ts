export type DiagnosticCode =
  | 'directive-unknown'
  | 'directive-misplaced'
  | 'directive-attr-unknown'
  | 'directive-attr-invalid'
  | 'image-attr-unknown'
  | 'image-attr-invalid'
  | 'placeholder-unknown'
  | 'html-disallowed'
  | 'asset-missing'
  | 'asset-outside'
  | 'math-error'
  | 'block-oversized';

export type Severity = 'error' | 'warning' | 'info';

/** A diagnostic produced by the renderer (0-based source line). */
export interface RenderDiagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  line: number;
}

/** A diagnostic with offsets relative to some text (a line or a document). */
export interface SyntaxIssue {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  from: number;
  to: number;
}

export const diagnosticSeverity: Record<DiagnosticCode, Severity> = {
  'directive-unknown': 'warning',
  'directive-misplaced': 'warning',
  'directive-attr-unknown': 'warning',
  'directive-attr-invalid': 'error',
  'image-attr-unknown': 'warning',
  'image-attr-invalid': 'error',
  'placeholder-unknown': 'warning',
  'html-disallowed': 'warning',
  'asset-missing': 'error',
  'asset-outside': 'error',
  'math-error': 'error',
  'block-oversized': 'warning',
};

/** Message templates of the syntax diagnostics. */
export const messages = {
  directiveUnknown: (name: string) => `Unknown directive '::${name}'.`,
  directiveMisplaced: () => 'Directives only work at the start of a top-level line.',
  directiveAttrUnknown: (key: string, name: string) => `'${key}' is not an attribute of ::${name}.`,
  directiveAttrInvalid: (key: string, name: string, reason: string) =>
    `Invalid value for '${key}' in ::${name}: ${reason}. The directive is ignored.`,
  imageAttrUnknown: (key: string) => `Image attribute '${key}' is not supported (use width, height, align).`,
  imageAttrInvalid: (key: string, value: string) => `Invalid image ${key} '${value}'.`,
  placeholderUnknown: (name: string) => `Unknown placeholder '{${name}}' (use {page} or {pages}).`,
  htmlDisallowed: (tag: string) => `<${tag}> is removed from the preview and PDF.`,
  assetMissing: (path: string) => `Image not found: ${path}.`,
  assetOutside: (path: string) => `Images must be stored under assets/ (found ${path}).`,
  mathError: (msg: string) => `Math error: ${msg}.`,
  blockOversized: (kind: string) =>
    kind === 'image'
      ? 'This image is taller than one page and will be clipped.'
      : `This ${kind === 'block' ? 'block' : kind === 'code' ? 'code block' : kind} is taller than one page and will be split across pages.`,
};
