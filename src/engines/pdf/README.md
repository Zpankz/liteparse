# src/engines/pdf/

PDF parsing engines for loading documents and extracting content.

## Files

### interface.ts
**Defines the PdfEngine contract and data types.**

**PdfEngine Interface:**
```typescript
interface PdfEngine {
  name: string;
  loadDocument(filePath: string): Promise<PdfDocument>;
  extractPage(doc: PdfDocument, pageNum: number): Promise<PageData>;
  extractAllPages(doc, maxPages?, targetPages?): Promise<PageData[]>;
  renderPageImage(doc, pageNum, dpi): Promise<Buffer>;
  close(doc: PdfDocument): Promise<void>;
}
```

**Key Data Types:**
- `PdfDocument` - Loaded document with `numPages`, `data` (Uint8Array), `metadata`
- `PageData` - Extracted page: `pageNum`, `width`, `height`, `textItems`, `images`, `annotations`
- `Image` - Embedded image with position, dimensions, and optional OCR data
- `Annotation` - PDF annotation (links, etc.)

---

### pdfjs.ts
**Default PDF engine using Mozilla's PDF.js library.**

**Key Responsibilities:**
- Load PDF documents with CMap and font support
- Extract text items with precise coordinates and font information
- Handle coordinate transformations (PDF space → viewport space)
- Parse `targetPages` syntax (e.g., "1-5,10,15-20")
- Delegate screenshot rendering to PDFium for quality

**Coordinate Transformation:**
PDF uses a bottom-left origin with Y pointing up. PDF.js provides transformation matrices that this code processes using:
- `multiplyMatrices()` - Combine viewport and item transforms
- `applyTransformation()` - Apply matrix to points
- `singularValueDecompose2dScale()` - Extract scale factors via SVD
- `getRotation()` - Extract rotation angle from matrix

**Text Decoding:**
Handles special PDF.js markers for problematic fonts:
- Decodes `:->|>_<charCode>_<fontChar>_<|<-:` format
- Handles pipe-separated characters: `|a| |b| |c|` → `abc`

**Design Decisions:**
- **Stores PDF path**: Needed for PDFium rendering (pdfjs.ts:95)
- **Filters off-page items**: Removes text with negative coords or beyond page bounds (pdfjs.ts:191-198)
- **Zero-size filtering**: Skips text items with 0 width/height (pdfjs.ts:125)

---

### pdfium-renderer.ts
**High-quality screenshot renderer using native PDFium library.**

Used for generating page images for OCR and the `screenshot` command. Provides better quality than PDF.js canvas rendering, especially for documents with inline images.

**Key Features:**
- Native C++ PDFium via `@hyzyla/pdfium` WASM binding
- Sharp for image processing (PNG output with configurable compression)
- DPI-based scaling (72 DPI baseline)
- Lazy initialization (only loads when first needed)

**Methods:**
- `init()` - Initialize PDFium library (called automatically)
- `renderPageToBuffer(pdfPath, pageNumber, dpi)` - Render page to PNG buffer
- `close()` - Cleanup PDFium resources

**Design Decision:**
Separate from PdfJsEngine because:
1. PDFium renders better quality images (important for OCR accuracy)
2. PDF.js is better for text extraction (mature parsing)
3. Separation allows independent optimization of each concern
