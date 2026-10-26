---
title: Linked folders
description: Keep a document in a normal folder on disk (Chromium).
---

In Chrome and Edge you can link a document to a folder on your disk. MDLeaf keeps working in its own storage and mirrors every change to the folder, so you can back it up, sync it with a cloud drive or put it under version control.

Firefox and Safari do not offer folder access to web apps, so these commands appear only in Chromium.

## Folder layout

```text
my-report/
├─ document.md      (or the name of your existing .md file)
├─ assets/…
├─ doc.json
└─ profile.json     (+ theme.css and theme.json for your own theme)
```

## Linking

- **Open folder…** in the Library turns a folder into a new linked document. If it has several Markdown files, MDLeaf asks which one is the document.
- **Link to folder…** in the editor's ⋯ menu links the current document. If the folder already has a document, choose to replace the folder's files with this document or to load the folder into it. Replacing writes only the files above and deletes nothing else.
- **Unlink folder** stops mirroring; the files stay on disk.

## Staying in sync

- Every save, image change, rename and move is mirrored. The status bar shows _Synced_, _Syncing…_ or a problem.
- When you open a document, MDLeaf checks the folder. If it was changed outside MDLeaf, choose **Load from folder** or **Keep MDLeaf version**.
- After a browser restart, the browser may ask for permission again: click **Reconnect** in the banner.
- If the folder was moved or deleted, the banner offers **Link again…** or **Unlink**.
