---
title: Optimising images
description: Optional downscaling and re-encoding.
---

Photos straight from a phone can be several megabytes. The **Optimise image** section of the Add image dialog can make them smaller before they are stored. It is **off by default**: the original file is kept byte for byte.

| Control              | Default          | Range                                       |
| -------------------- | ---------------- | ------------------------------------------- |
| Resize and re-encode | off (remembered) |                                             |
| Max width (px)       | 1600             | 16–10000; smaller images are never enlarged |
| Format               | WebP             | WebP or JPEG                                |
| Quality              | 80               | 1–100                                       |

While the section is on, the dialog shows both sizes, for example _Original: 2.4 MB (3024 × 4032) → Result: 312 KB (1600 × 2133)_, and recalculates shortly after you change a control. If the result is bigger than the original it says so.

- The photo's orientation is applied before resizing, so portrait photos stay upright.
- Re-encoded files do not keep EXIF metadata (camera, location).
- JPEG has no transparency: transparent areas become white.
- SVG and animated GIF/WebP images are always kept as they are.

The encoders run in the browser and work offline. Your choices are remembered for the next image.
