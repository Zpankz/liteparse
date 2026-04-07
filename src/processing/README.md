# src/processing/

The processing module is the **heart of LiteParse** - responsible for transforming raw PDF content into structured, spatially-aware text. This is where text extraction, layout reconstruction, and OCR integration happen.

## Files

### grid.ts
**Thin wrapper around gridProjection.ts.**

Simply merges user config with defaults and calls `projectPagesToGridComplete`. Exists to provide a cleaner import path and handle configuration.

---

### gridProjection.ts (~1650 lines)
**The most complex module - spatial text layout reconstruction.**

This is the core algorithm that converts raw PDF text items into readable, properly-ordered text that preserves document layout.

**Key Concepts:**

1. **Anchors**: Track where text aligns on the page
   - `anchorLeft` - Text left-edges (column starts)
   - `anchorRight` - Text right-edges (column ends)
   - `anchorCenter` - Text centers (centered content)

2. **Snap Types**: How text aligns to columns
   - `left` - Text snaps to left edge of a column
   - `right` - Text snaps to right edge
   - `center` - Text is centered
   - `floating` - Unaligned/justified text

3. **Forward Anchors**: Carry alignment information between lines
   - Enables consistent column detection across the page
   - Prevents duplicate text detection (`isDup` flag)

4. **Rotation Handling**: PDFs can contain rotated text (90°, 180°, 270°)
   - `handleRotationReadingOrder()` transforms rotated text to reading order
   - Groups text by rotation value, not just position
   - For 90°/270° text without visual overlap: transforms coordinates to maintain reading order
   - For 90°/270° text with overlap: keeps in place but marks as rotated
   - For 180° text: flips coordinates to correct upside-down text

5. **Margin Line Number Detection**: Two-column documents often have line numbers in the gutter
   - Detects short numeric items (1-2 digits) near the page midpoint
   - Marks them as `isMarginLineNumber` to prevent merging with column content
   - Ensures line numbers appear on their own line

**Algorithm Flow:**
1. Build bounding boxes from text items and OCR data
2. Handle rotated text reading order (`handleRotationReadingOrder`)
3. Sort text into lines by Y-coordinate (`bboxToLine`)
4. Extract anchor points from all text items (`extractAnchorsPointsFromLines`)
5. Try to align floating text with nearby anchors (`tryAlignFloating`)
6. Detect text snapping (left, right, center, or floating)
7. Project lines onto character grid with proper spacing
8. Apply markup tags (highlight, underline, strikeout)
9. Clean up sparse blocks and margins

**Key Functions:**
- `handleRotationReadingOrder()` - Transform rotated text to correct reading order
- `bboxToLine()` - Group text items into lines with Y-tolerance for subscripts
- `extractAnchorsPointsFromLines()` - Identify alignment anchors and deduplicate
- `tryAlignFloating()` - Align floating bboxes with anchors on adjacent lines
- `projectToGrid()` - Main projection algorithm (accepts a `GridDebugLogger` for tracing)
- `projectPagesToGrid()` - Process all pages with shared anchors, creates debug logger from config

**Constants:**
- `FLOATING_SPACES = 2` - Minimum spaces between floating text
- `COLUMN_SPACES = 4` - Minimum spaces between columns
- `SMALL_FONT_SIZE_THRESHOLD = 2` - Filter very small text (2pt @ 72 DPI)
- `Y_SORT_TOLERANCE` - Tolerance for same-line detection (scales with median height, min 5.0)

**Design Decisions:**
- **Anchor rounding**: Groups anchor x-coords by nearest 1/4 unit to handle slight variations
- **Sparse block compression**: Reduces excessive whitespace in sparse layouts (>80% whitespace)
- **Small text filtering**: Lines with >50% small text can be filtered (configurable)
- **Rotation grouping**: Text is grouped by rotation value before processing, so rotated blocks stay together even when X coordinates overlap with non-rotated content
- **Y-tolerance sorting**: Items within `Y_SORT_TOLERANCE` are considered same line, handling floating-point precision and subscripts/superscripts

---

### gridDebugLogger.ts
**Targeted debug logging for grid projection.**

Provides a `GridDebugLogger` class that traces projection decisions at every stage — block detection, anchor extraction, snap assignment, rendering, flowing text classification, and forward anchor updates. Uses a filter system to narrow output to specific elements.

**`GridDebugConfig` options:**
- `enabled` - Master switch
- `textFilter` - Only log elements whose text contains these substrings (case-insensitive)
- `lineFilter` - Only log elements on these line indices (0-based)
- `pageFilter` - Only log elements on this page number (1-indexed)
- `regionFilter` - Only log elements within a bounding region `{ x1, y1, x2, y2 }`
- `outputPath` - Write log to a file instead of stderr
- `visualize` - Generate PNG visualizations (see gridVisualizer.ts)
- `visualizePath` - Directory for visualization PNGs (default: `./debug-output`)

**Log phases:** `page`, `blocks`, `anchors`, `snap`, `render`, `flowing`, `forward-anchor`, `dedup`, `lines`

When disabled, a zero-cost `NoopGridDebugLogger` singleton is used — no runtime overhead in production.

---

### gridVisualizer.ts
**PNG visualization of grid projection state.**

Renders a page's projection as a PNG image using sharp with an SVG overlay. Text boxes are drawn as colored rectangles by snap type:
- **Blue** — left snap
- **Red** — right snap
- **Green** — center snap
- **Gray** — floating (unsnapped)
- **Yellow** — flowing text

Also draws vertical dashed lines for anchor positions and block boundary outlines. Includes a color legend.

Called automatically when `debug.visualize` is enabled. Output files are named `page-{N}-grid.png` in the configured directory.

---

### bbox.ts
**Bounding box construction and OCR integration.**

**Key Functions:**

`buildBbox(pageData, config)` - Main function that:
1. Converts `TextItem[]` to `ProjectionTextBox[]` with additional metadata
2. Processes embedded images for OCR if enabled
3. Filters images by size, position, and type
4. Filters OCR results that overlap with existing text (50% spatial threshold)
5. Filters OCR results whose text content already exists in native PDF text (content-based deduplication)
6. Returns combined text boxes for grid projection

`buildBoundingBoxes(textItems)` - Simple conversion of text items to `BoundingBox[]` format (x1, y1, x2, y2).

**OCR Filtering Constants:**
- `OCR_CONFIDENCE_THRESHOLD = 0.1` - Minimum OCR confidence
- `OCR_OVERLAP_THRESHOLD = 0.5` - Reject OCR if >50% overlaps existing text
- `MAX_IMAGES_PER_PAGE = 10` - Limit images processed per page
- `MIN_IMAGE_DIMENSION = 12` - Skip tiny images
- `MIN_IMAGE_AREA = 200` - Skip small-area images

**Design Decisions:**
- **Spatial overlap filtering**: Prevents duplicate text when OCR and PDF extraction detect the same content at the same location. Native PDF text is preferred over OCR.
- **Content-based deduplication**: Filters OCR text that matches existing PDF text content regardless of position. This handles cases like watermarks or embedded images containing text that already appears elsewhere on the page.

---

### ocrUtils.ts
**OCR result parsing and coordinate conversion.**

**Key Functions:**

`parseImageOcrBlocks(image)`:
- Converts OCR bounding boxes from image space to page space
- Handles scale factors and coordinate ratios
- Returns `OcrBlock[]` with both page-space and raw coordinates

`easyOcrResultLinesToList(stdOutResult)`:
- Parses EasyOCR stdout format into structured data
- Format: `([[x1,y1], [x2,y2], [x3,y3], [x4,y4]], 'text', confidence)`

**Coordinate Systems:**
- **Image space**: Coordinates relative to the OCR'd image
- **Page space**: Coordinates relative to the PDF page viewport
- Conversion uses `xRatio = image.width / coords.w`

---

### textUtils.ts
**Unicode subscript and superscript conversion.**

Used for scientific notation and mathematical text.

- `strToSubscriptString(str)` - Converts "H2O" → "H₂O"
- `strToPostScript(str)` - Converts "x2" → "x²"

Supports: digits 0-9, +/-, common letters (a-z, A-Z subset)

If any character lacks a Unicode equivalent, returns original string unchanged.

---

### cleanText.ts
**Post-processing text cleanup.**

`cleanRawText(pages, config)`:
1. **Margin removal** (per page):
   - Detects consistent left margin (leading whitespace)
   - Removes top margin (empty lines at start)
   - Removes bottom margin (empty lines at end)
   - Trims right margin (trailing whitespace)
2. **Null character removal**: Replaces `\u0000` with spaces

---

### markupUtils.ts
**Apply inline markup tags from PDF annotations.**

`applyMarkupTags(markup, text)` - Wraps text with markup:
- Strikeout → `~~text~~`
- Underline → `__text__`
- Squiggly → `__text__` (same as underline)
- Highlight → `==text==`

These tags can be converted to markdown or other formats downstream.

---

## Data Flow

```
PageData (from PDF engine)
    │
    ▼
buildBbox() ─────────────────────────────┐
    │                                    │
    │  Converts TextItems to             │  Processes embedded
    │  ProjectionTextBox[]               │  images with OCR data
    │                                    │
    └────────────┬───────────────────────┘
                 │
                 ▼
    ProjectionTextBox[] (unified text boxes)
                 │
                 ▼
    projectPagesToGrid()
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
Extract      Detect        Project
Anchors      Snapping      to Grid
    │            │            │
    └────────────┴────────────┘
                 │
                 ▼
    ParsedPage[] with reconstructed text
                 │
                 ▼
    cleanRawText() - Remove margins, cleanup
                 │
                 ▼
    Final text output
```

## Common Modifications

### Adjusting column detection sensitivity
Modify `roundAnchor()` in `gridProjection.ts` - currently rounds to nearest 1/4 unit.

### Changing OCR overlap threshold
Modify `OCR_OVERLAP_THRESHOLD` in `bbox.ts` (default: 0.5 = 50%).

### Adding new markup types
1. Add field to `MarkupData` in `src/core/types.ts`
2. Add case in `applyMarkupTags()` in `markupUtils.ts`
