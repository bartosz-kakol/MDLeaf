---
title: Syntax cheat sheet
description: All MDLeaf extended syntax on one page.
---

## Directives

Directives go on their own line, at the start of the line, outside lists and quotes.

| Syntax                                 | Effect                                            |
| -------------------------------------- | ------------------------------------------------- |
| `::pagebreak`                          | New page                                          |
| `::toc`                                | Table of contents (headings up to level 3)        |
| `::toc{depth=2 title="Contents"}`      | Up to level 2, custom title (`title=""` for none) |
| `::header[Text]`                       | Centred running header from this page on          |
| `::header[Left\|Right]`                | Left and right header                             |
| `::header[Left\|Centre\|Right]`        | Three-part header                                 |
| `::footer[\|Page {page} of {pages}\|]` | Centred footer with page numbers                  |
| `::header[]`                           | Remove the header from this page on               |
| `::hide`                               | No header and footer on this page                 |
| `::hide{header}` / `::hide{footer}`    | Only one of them                                  |
| `::pagenumber{start=1}`                | This page is number 1                             |
| `::pagenumber{offset=-2}`              | Shift numbers by −2 from here                     |
| `\::pagebreak`                         | Literal text                                      |

Placeholders in headers and footers: `{page}`, `{pages}`; `{{` and `}}` for braces.

## Images

| Syntax                                       | Effect                   |
| -------------------------------------------- | ------------------------ |
| `![](assets/a.png)`                          | Fits the text width      |
| `![](assets/a.png){width=60%}`               | 60 % of the text width   |
| `![](assets/a.png){width=80mm align=center}` | Centred, 80 mm wide      |
| `![](assets/a.svg){height=2cm align=right}`  | Right-aligned, 2 cm tall |

Units: `px` (default), `%`, `mm`, `cm`, `in`, `pt`.

Keep images inside the `assets/` folder (subfolders are fine) and use relative paths. PNG, JPEG, GIF, WebP, AVIF and SVG files work.

## Math and footnotes

| Syntax                      | Effect                         |
| --------------------------- | ------------------------------ |
| `$x^2$`                     | Inline math                    |
| `$$` … `$$`                 | Display math                   |
| `text[^1]` and `[^1]: note` | Footnote (shown as an endnote) |

## Recipes

A report with cover, contents and numbered body:

```md
::footer[|Page {page} of {pages}|]

# My Report

::pagebreak

::toc

::pagebreak
::pagenumber{start=1}

## Introduction
```
