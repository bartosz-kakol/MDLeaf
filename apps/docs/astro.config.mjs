// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

const site = process.env.PUBLIC_DOCS_URL ?? 'https://mdleaf-docs.pages.dev';

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'MDLeaf',
      description: 'Write paginated Markdown documents with running headers, a table of contents and PDF export — offline.',
      logo: { src: './src/assets/leaf.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/docs.css'],
      components: { SocialIcons: './src/components/HeaderLinks.astro' },
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'What is MDLeaf?', slug: 'index' },
            { label: 'Install and work offline', slug: 'start/install' },
            { label: 'Your first document', slug: 'start/first-document' },
          ],
        },
        {
          label: 'Writing',
          items: [
            { label: 'Markdown', slug: 'writing/markdown' },
            { label: 'Math', slug: 'writing/math' },
            { label: 'Footnotes', slug: 'writing/footnotes' },
          ],
        },
        {
          label: 'Extended syntax',
          items: [
            { label: 'Directives', slug: 'syntax/directives' },
            { label: 'Page breaks', slug: 'syntax/page-breaks' },
            { label: 'Table of contents', slug: 'syntax/table-of-contents' },
            { label: 'Headers and footers', slug: 'syntax/headers-and-footers' },
            { label: 'Hiding headers', slug: 'syntax/hiding-headers' },
            { label: 'Page numbering', slug: 'syntax/page-numbering' },
            { label: 'Image attributes', slug: 'syntax/image-attributes' },
            { label: 'Pagination rules', slug: 'syntax/pagination-rules' },
          ],
        },
        {
          label: 'Images & assets',
          items: [
            { label: 'Organising assets', slug: 'assets/organising' },
            { label: 'Pasting images', slug: 'assets/pasting-images' },
            { label: 'Optimising images', slug: 'assets/optimising' },
          ],
        },
        {
          label: 'Layout & themes',
          items: [
            { label: 'Profiles', slug: 'styling/profiles' },
            { label: 'Built-in themes', slug: 'styling/built-in-themes' },
            { label: 'Custom themes', slug: 'styling/custom-themes' },
            { label: 'CSS contract', slug: 'styling/css-contract' },
            { label: 'Starter stylesheet', slug: 'styling/starter-stylesheet' },
          ],
        },
        {
          label: 'Files & storage',
          items: [
            { label: 'Storage', slug: 'files/storage' },
            { label: 'The .mdl format', slug: 'files/mdl-format' },
            { label: 'Linked folders', slug: 'files/folders' },
            { label: 'Command line and AI agents', slug: 'files/command-line' },
          ],
        },
        {
          label: 'Keyboard',
          items: [
            { label: 'Shortcuts', slug: 'keyboard/shortcuts' },
            { label: 'Palette and rebinding', slug: 'keyboard/palette-and-rebinding' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Syntax cheat sheet', slug: 'reference/syntax-cheatsheet' },
            { label: 'Diagnostics', slug: 'reference/diagnostics' },
          ],
        },
      ],
    }),
  ],
  vite: {
    worker: { format: 'es' },
  },
});
