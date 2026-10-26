/** The command catalog: pure data shared by the app and the docs. */

export type CommandCategory = 'Format' | 'Insert' | 'Page' | 'View' | 'Navigate' | 'File' | 'Document' | 'Assets' | 'App';
export type CommandScope = 'global' | 'editor' | 'assetsTree';

export interface CommandSpec {
  id: string;
  label: string;
  category: CommandCategory;
  /** tinykeys syntax; [] = no default. */
  defaultKeys: string[];
  scope: CommandScope;
  /** lucide icon name. */
  icon?: string;
  palette?: boolean;
}

const c = (
  id: string,
  label: string,
  category: CommandCategory,
  defaultKeys: string[],
  scope: CommandScope,
  icon?: string,
  palette = true,
): CommandSpec => ({ id, label, category, defaultKeys, scope, icon, palette });

export const COMMANDS: readonly CommandSpec[] = [
  // Format
  c('format.bold', 'Bold', 'Format', ['$mod+b'], 'editor', 'bold'),
  c('format.italic', 'Italic', 'Format', ['$mod+i'], 'editor', 'italic'),
  c('format.strikethrough', 'Strikethrough', 'Format', ['$mod+Shift+x'], 'editor', 'strikethrough'),
  c('format.code', 'Inline code', 'Format', ['$mod+e'], 'editor', 'code'),
  ...[1, 2, 3, 4, 5, 6].map((n) => c(`format.heading${n}`, `Heading ${n}`, 'Format', [`$mod+Alt+Digit${n}`], 'editor', `heading-${n}`)),
  c('format.paragraph', 'Normal text', 'Format', ['$mod+Alt+Digit0'], 'editor', 'pilcrow'),
  c('format.bulletList', 'Bulleted list', 'Format', ['$mod+Shift+Digit8'], 'editor', 'list'),
  c('format.numberedList', 'Numbered list', 'Format', ['$mod+Shift+Digit7'], 'editor', 'list-ordered'),
  c('format.taskList', 'Task list', 'Format', ['$mod+Shift+Digit9'], 'editor', 'list-todo'),
  c('format.blockquote', 'Quote', 'Format', ['$mod+Shift+Period'], 'editor', 'quote'),
  // Insert
  c('insert.link', 'Link', 'Insert', ['$mod+k'], 'editor', 'link'),
  c('insert.headingLink', 'Link to heading…', 'Insert', ['$mod+Shift+k'], 'editor', 'hash'),
  c('insert.image', 'Image…', 'Insert', ['$mod+Shift+i'], 'editor', 'image'),
  c('insert.table', 'Table', 'Insert', ['$mod+Shift+l'], 'editor', 'table'),
  c('insert.codeBlock', 'Code block', 'Insert', ['$mod+Shift+e'], 'editor', 'braces'),
  c('insert.mathInline', 'Inline math', 'Insert', ['$mod+Shift+m'], 'editor', 'sigma'),
  c('insert.mathBlock', 'Math block', 'Insert', ['$mod+Alt+Shift+m'], 'editor', 'square-sigma'),
  c('insert.footnote', 'Footnote', 'Insert', ['$mod+Shift+f'], 'editor', 'superscript'),
  c('insert.horizontalRule', 'Horizontal rule', 'Insert', ['$mod+Shift+h'], 'editor', 'minus'),
  // Page
  c('insert.pageBreak', 'Page break', 'Page', ['$mod+Enter'], 'editor', 'separator-horizontal'),
  c('insert.toc', 'Table of contents', 'Page', [], 'editor', 'list-tree'),
  c('insert.header', 'Running header…', 'Page', [], 'editor', 'panel-top'),
  c('insert.footer', 'Running footer…', 'Page', [], 'editor', 'panel-bottom'),
  c('insert.hide', 'Hide header/footer on this page…', 'Page', [], 'editor', 'eye-off'),
  c('insert.pageNumber', 'Page numbering…', 'Page', [], 'editor', 'list-ordered'),
  // View
  c('view.toggleMode', 'Toggle draft / page view', 'View', ['$mod+Shift+d'], 'global', 'book-open'),
  c('view.draft', 'Draft view', 'View', [], 'global', 'scroll-text'),
  c('view.page', 'Page view', 'View', [], 'global', 'book-open'),
  c('view.cycleLayout', 'Cycle editor / split / preview', 'View', ['$mod+Backslash'], 'global', 'columns-2'),
  c('view.layoutEditor', 'Editor only', 'View', [], 'global', 'square-pen'),
  c('view.layoutSplit', 'Split', 'View', [], 'global', 'columns-2'),
  c('view.layoutPreview', 'Preview only', 'View', [], 'global', 'eye'),
  c('view.toggleAssets', 'Toggle assets panel', 'View', ['$mod+Shift+a'], 'global', 'folder-tree'),
  c('view.toggleProblems', 'Toggle problems panel', 'View', ['$mod+Shift+Semicolon'], 'global', 'triangle-alert'),
  c('view.toggleScrollSync', 'Toggle scroll follow', 'View', [], 'global', 'move-vertical'),
  c('view.zoomIn', 'Zoom in', 'View', [], 'global', 'zoom-in'),
  c('view.zoomOut', 'Zoom out', 'View', [], 'global', 'zoom-out'),
  c('view.zoomFit', 'Fit width', 'View', [], 'global', 'scan'),
  // Navigate
  c('nav.find', 'Find and replace', 'Navigate', ['$mod+f'], 'global', 'search'),
  c('nav.gotoLine', 'Go to line…', 'Navigate', ['$mod+g'], 'global', 'arrow-down-to-line'),
  c('nav.nextProblem', 'Next problem', 'Navigate', ['F8'], 'global', 'chevron-down'),
  c('nav.prevProblem', 'Previous problem', 'Navigate', ['Shift+F8'], 'global', 'chevron-up'),
  c('nav.nextRegion', 'Focus next region', 'Navigate', ['F6'], 'global', 'arrow-right'),
  c('nav.prevRegion', 'Focus previous region', 'Navigate', ['Shift+F6'], 'global', 'arrow-left'),
  c('edit.undo', 'Undo', 'Navigate', ['$mod+z'], 'editor', 'undo-2'),
  c('edit.redo', 'Redo', 'Navigate', ['$mod+Shift+z', '$mod+y'], 'editor', 'redo-2'),
  // File / Document
  c('file.save', 'Save now', 'File', ['$mod+s'], 'global', 'save'),
  c('file.exportPdf', 'Export PDF…', 'File', ['$mod+p'], 'global', 'file-down'),
  c('file.exportMdl', 'Export .mdl…', 'File', ['$mod+Shift+s'], 'global', 'package'),
  c('file.exportMd', 'Export .md…', 'File', [], 'global', 'file-text'),
  c('file.linkFolder', 'Link to folder…', 'File', [], 'global', 'folder-sync'),
  c('file.unlinkFolder', 'Unlink folder', 'File', [], 'global', 'unlink'),
  c('doc.open', 'Open document…', 'Document', ['$mod+o'], 'global', 'folder-open'),
  c('doc.new', 'New document', 'Document', [], 'global', 'file-plus'),
  c('doc.settings', 'Document settings…', 'Document', ['$mod+Shift+Comma'], 'global', 'sliders-horizontal'),
  c('doc.library', 'Go to library', 'Document', [], 'global', 'library'),
  c('doc.delete', 'Delete document…', 'Document', [], 'global', 'trash-2'),
  // Assets
  c('assets.insert', 'Insert into document', 'Assets', ['Enter'], 'assetsTree', 'corner-down-left'),
  c('assets.rename', 'Rename', 'Assets', ['F2'], 'assetsTree', 'pencil'),
  c('assets.delete', 'Delete…', 'Assets', ['Delete', 'Backspace'], 'assetsTree', 'trash-2'),
  c('assets.moveTo', 'Move to…', 'Assets', ['m'], 'assetsTree', 'folder-input'),
  c('assets.newFolder', 'New folder…', 'Assets', [], 'global', 'folder-plus'),
  c('assets.upload', 'Upload image…', 'Assets', [], 'global', 'upload'),
  c('assets.deleteUnused', 'Delete unused assets…', 'Assets', [], 'global', 'trash'),
  // App
  c('app.palette', 'Command palette', 'App', ['$mod+Shift+p', 'F1'], 'global', 'command'),
  c('app.settings', 'Settings', 'App', ['$mod+Comma'], 'global', 'settings'),
  c('app.shortcuts', 'Keyboard shortcuts', 'App', ['$mod+Slash'], 'global', 'keyboard'),
  c('app.persistStorage', 'Request persistent storage', 'App', [], 'global', 'hard-drive'),
];

export function findCommand(id: string): CommandSpec | undefined {
  return COMMANDS.find((cmd) => cmd.id === id);
}

export const CATEGORY_ORDER: readonly CommandCategory[] = [
  'Format',
  'Insert',
  'Page',
  'View',
  'Navigate',
  'File',
  'Document',
  'Assets',
  'App',
];
