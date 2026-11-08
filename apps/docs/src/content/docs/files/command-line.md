---
title: Command line and AI agents
description: Check, paginate and export MDLeaf documents from a terminal or an AI agent (MCP).
---

The `mdleaf` command works on documents saved on your disk. It checks the syntax, lays the pages out exactly as the app does, and exports PDFs. It also runs as an MCP server, so AI agents such as Claude can do the same.

It runs entirely on your computer. There is no account, and nothing is sent anywhere.

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

`mdleaf mcp` gives an agent the tools `lint_document`, `document_outline`, `paginate_document`, `export_pdf` and `syntax_reference`, plus `create_workspace`, `lock_document` and `unlock_document` for [agent workspaces](#agent-workspaces). For Claude Code:

```sh
claude mcp add mdleaf -- mdleaf mcp
```

Other MCP clients take the command `mdleaf` with the argument `mcp`.

The tools only read the paths the agent passes, and `export_pdf` will not overwrite a file unless asked to. The agent itself sends tool results, including your text, to its AI provider. That is how the agent works, not something MDLeaf does.

When an agent edits a linked folder while the document is open in MDLeaf, the app notices within a few seconds and asks which version to keep. Until you choose, your edits stay in MDLeaf and the folder is left alone.

## Agent workspaces

A folder with a `.mdleaf.json` file is a workspace. While an AI agent with the MDLeaf MCP server is running in that folder, the workspace appears at the top of your document list with a robot icon, in any browser. Open it to edit and preview it as usual. Turn on **Show command-line and agent activity** in **Settings → General** first.

Ask the agent to create a workspace, or to work in a folder that has one. The document and images stay in the folder, and `.mdleaf.json` holds its title and page settings, so nothing is kept in your browser. To delete a workspace, delete the folder or `.mdleaf.json`.

When an agent edits the document, it locks it first:

- MDLeaf saves what you have typed and makes the document read-only.
- The agent's changes appear as it makes them, and the editor and preview scroll to follow them.
- When the agent unlocks the document, you can edit again. The lock also ends if the agent's process exits.

If an agent is interrupted or forgets to unlock, press and hold **Hold to force unlock** for 4 seconds. This does not stop the agent: if it is still working, it can overwrite what you type. The agent is told the next time it uses an MDLeaf tool, so it can read the document again.

### Browsers that block the connection

Chrome, Edge and Firefox ask once for permission to reach apps on your computer. Safari refuses that connection from a website, so in Safari click **Can't see your agent?** in the status bar. A small window opens that connects MDLeaf to the agent; keep it open while you work. Allow pop-ups for MDLeaf if Safari blocks it.

## Seeing activity in the app

Turn on **Show command-line and agent activity** in **Settings → General** to see in the status bar when the command or an agent is working, for example _Claude Code: paginating report.md_. Your browser may ask to allow access to apps on this device.

While it runs, `mdleaf` listens on `127.0.0.1:47821`, reachable only from this computer. It answers only the MDLeaf app, and shares the name of the agent, the action and the file name, never its full path or contents. A `mdleaf lint` or `outline` too short to be seen on its own appears only while an agent session or a longer command is running.

To turn this off in the command, set the environment variable `MDLEAF_NO_STATUS=1`. If you host the app yourself, set `MDLEAF_APP_ORIGIN` to its origin.

## Differences from the app

Pages are laid out with Chromium, so they match what Chrome and Edge show. Firefox and Safari can break pages slightly differently.
