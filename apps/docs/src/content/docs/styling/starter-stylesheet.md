---
title: Starter stylesheet
description: A complete template for your own theme.
---

The starter stylesheet lists every writable [contract property](/styling/css-contract/) with its default value and a comment, followed by commented-out examples for the structural classes. Copy it, delete what you do not change, and adjust the rest.

<a href="/downloads/mdleaf-starter.css" download>Download mdleaf-starter.css</a>

You can also download it from _Settings → Themes → Download starter stylesheet_, or start from a built-in theme with _Download CSS_ next to it.

## Rules

1. Set custom properties on `:root`.
2. Do not set the read-only layout properties (`--mdl-page-width`, `--mdl-margin-top`, …); MDLeaf sets them from the profile.
3. For a theme you add as a file and want to use offline, embed fonts as `data:` URLs.

## A tiny theme

```css
:root {
  --mdl-font-body: "Inter Variable", system-ui, sans-serif;
  --mdl-color-accent: #0f766e;
  --mdl-heading-color: #0f766e;
  --mdl-h1-size: 2.4em;
}
.mdl-page-footer {
  border-top: 0.5pt solid var(--mdl-color-border);
}
```

Add it in _Settings → Themes → Add from file…_ and choose it in a profile.
