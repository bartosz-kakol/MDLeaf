---
title: Command line and AI agents
description: Check, paginate and export MDLeaf documents from a terminal or an AI agent (MCP).
---

The `mdleaf` command works on documents saved on your disk. It checks the syntax, lays the pages out exactly as the app does, and exports PDFs. It also runs as an MCP server, so AI agents such as Claude can do the same.

It runs entirely on your computer. There is no server and no account, and nothing is sent anywhere.

## Install

```sh
npm install -g @mdleaf/cli
```

Laying out pages and exporting PDFs uses your installed Google Chrome or Microsoft Edge in the background. Without either, run `npx playwright install chromium` once. This is the only step that downloads anything.

## Which documents it can open

- a `.md` file: images are read from the `assets/` folder next to it
- a [linked folder](/files/folders/) (Chrome and Edge)
- a [`.mdl` archive](/files/mdl-format/) (any browser: **Export .mdl** in the editor)

Documents that exist only inside the app's browser storage are not visible to the command. Link the document to a folder, or export it as `.mdl`.

## Commands

| Command                         | What it does                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `mdleaf lint <path>`            | Problems from the editor: directives, image attributes, missing images, math |
| `mdleaf outline <path>`         | Headings with their link anchors and lines                            |
| `mdleaf paginate <path>`        | Page count, the page of each heading, blocks taller than a page       |
| `mdleaf pdf <path> -o file.pdf` | PDF export with the document's page size                              |
| `mdleaf reference`              | The [syntax cheat sheet](/reference/syntax-cheatsheet/)               |
| `mdleaf mcp`                    | MCP server for AI agents                                              |

Options: `--json` for machine-readable output, `--offline` to block remote images and stylesheets, `--profile builtin:default-letter` for documents without a `doc.json`.

`lint` exits with status 1 when it finds errors, so it can run in a script or CI.

## AI agents (MCP)

`mdleaf mcp` gives an agent the tools `lint_document`, `document_outline`, `paginate_document`, `export_pdf` and `syntax_reference`. For Claude Code:

```sh
claude mcp add mdleaf -- mdleaf mcp
```

Other MCP clients take the command `mdleaf` with the argument `mcp`.

The tools only read the paths the agent passes, and `export_pdf` will not overwrite a file unless asked to. The agent itself sends tool results, including your text, to its AI provider. That is how the agent works, not something MDLeaf does.

When an agent edits a linked folder while the document is open in MDLeaf, the app notices the change the next time you open the document and asks which version to keep.

## Differences from the app

Pages are laid out with Chromium, so they match what Chrome and Edge show. Firefox and Safari can break pages slightly differently.
