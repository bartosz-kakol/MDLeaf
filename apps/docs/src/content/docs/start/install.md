---
title: Install and work offline
description: Open MDLeaf, install it as an app, and use it without a network.
---

MDLeaf runs entirely in your browser. There is no account and no server: documents are stored in the browser's private file system on your device.

## Open MDLeaf

Open the app in Chrome, Edge, Firefox or Safari. Supported versions are Chromium 122 or newer, Firefox 128 ESR or newer, and Safari 17.4 or newer.

## Install it

- **Chrome and Edge**: use the install icon in the address bar, or _Menu → Install MDLeaf_.
- **Safari (macOS)**: _File → Add to Dock_.
- **Firefox**: Firefox does not install web apps, but MDLeaf works the same in a normal tab, including offline.

An installed MDLeaf (Chromium) can also open `.mdl` and `.md` files directly from your file manager.

## Working offline

On the first visit MDLeaf downloads everything it needs. The Library footer shows **Offline ready ✓** when that is done. From then on, every feature works without a network: editing, page view, PDF export, image re-encoding, the built-in themes and fonts.

Only two things need a network:

- **URL themes** are refreshed when you are online. Offline, MDLeaf uses the last downloaded copy (see [custom themes](/styling/custom-themes/)).
- **Remote images** (`https://` URLs in your Markdown) load only when online. Images you paste or upload are stored with the document and always work.

## Updates

When a new version is available, MDLeaf shows _A new version of MDLeaf is available_ with a **Reload** button. It never reloads by itself, so an update can never interrupt your writing. Reload saves your work first.

## Keep your data safe

MDLeaf asks the browser to keep its storage persistent when you create your first document. You can check this in _Settings → About_. To move documents between devices or keep backups, use **Export .mdl** (see [the .mdl format](/files/mdl-format/)).
