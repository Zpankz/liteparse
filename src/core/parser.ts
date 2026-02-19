import pLimit from "p-limit";
import { LiteParseConfig, ParseResult, ScreenshotResult, TextItem } from "./types.js";
import { mergeConfig } from "./config.js";
import { PdfEngine, PdfDocument, PageData } from "../engines/pdf/interface.js";
import { PdfJsEngine } from "../engines/pdf/pdfjs.js";
import { PdfiumRenderer } from "../engines/pdf/pdfium-renderer.js";
import { OcrEngine } from "../engines/ocr/interface.js";
import { TesseractEngine } from "../engines/ocr/tesseract.js";
import { HttpOcrEngine } from "../engines/ocr/http-simple.js";
import { projectPagesToGrid } from "../processing/grid.js";
import { buildBoundingBoxes } from "../processing/bbox.js";
import { formatJSON } from "../output/json.js";
import { convertToPdf, cleanupConversionFiles } from "../conversion/convertToPdf.js";

export class LiteParse {
  private config: LiteParseConfig;
  private pdfEngine: PdfEngine;
  private ocrEngine?: OcrEngine;

  constructor(userConfig: Partial<LiteParseConfig> = {}) {
    // Merge user config with defaults
    this.config = mergeConfig(userConfig);

    // Initialize PDF engine
    this.pdfEngine = new PdfJsEngine();

    // Initialize OCR engine
    // Auto-detect: use HTTP OCR if URL provided, otherwise use Tesseract
    if (this.config.ocrEnabled) {
      if (this.config.ocrServerUrl) {
        this.ocrEngine = new HttpOcrEngine(this.config.ocrServerUrl);
      } else {
        this.ocrEngine = new TesseractEngine(this.config.numWorkers);
      }
    }
  }

  /**
   * Parse a PDF file and return structured result
   */
  async parse(filePath: string, quiet = false): Promise<ParseResult> {
    const log = (msg: string) => {
      if (!quiet) console.error(msg); // Progress goes to stderr
    };

    log(`Processing file: ${filePath}`);
    const conversionResult = await convertToPdf(filePath);

    if ("code" in conversionResult) {
      // Conversion error
      throw new Error(`Conversion failed: ${conversionResult.message}`);
    }

    // Return early for text-based passthrough formats
    if ("content" in conversionResult) {
      log(`File is a text-based format. Returning content directly.`);
      return {
        pages: [],
        text: conversionResult.content,
      };
    }

    // Convert to PDF if needed
    const pdfPath = conversionResult.pdfPath;
    const needsCleanup = pdfPath !== filePath;

    if (needsCleanup) {
      log(`Converted ${conversionResult.originalExtension} to PDF`);
    }

    log(`Parsing PDF: ${pdfPath}`);
    log(`Using ${this.pdfEngine.name} engine`);

    // Load PDF document
    const doc = await this.pdfEngine.loadDocument(pdfPath);
    log(`Loaded PDF with ${doc.numPages} pages`);

    // Extract pages
    const pages = await this.pdfEngine.extractAllPages(
      doc,
      this.config.maxPages,
      this.config.targetPages
    );
    log(`Extracted ${pages.length} pages`);

    // run BEFORE grid projection
    if (this.ocrEngine) {
      await this.runOCR(doc, pages, log);
    }

    // Process pages with complete grid projection (after OCR)
    const processedPages = projectPagesToGrid(pages, this.config);

    // Build bounding boxes if enabled
    if (this.config.preciseBoundingBox) {
      for (const page of processedPages) {
        page.boundingBoxes = buildBoundingBoxes(page.textItems);
      }
    }

    // Build final text
    const fullText = processedPages.map((p) => p.text).join("\n\n");

    // Close PDF document
    await this.pdfEngine.close(doc);

    // Cleanup OCR engine if it's Tesseract (to free memory)
    if (this.ocrEngine && "terminate" in this.ocrEngine) {
      await (this.ocrEngine as TesseractEngine).terminate();
    }

    // Cleanup temporary conversion files
    if (needsCleanup) {
      await cleanupConversionFiles(pdfPath);
    }

    const result: ParseResult = {
      pages: processedPages,
      text: fullText,
    };

    // Format based on output format
    switch (this.config.outputFormat) {
      case "json":
        result.json = JSON.parse(formatJSON(result));
        break;
      case "text":
        // Already in text format
        break;
    }

    return result;
  }

  /**
   * Generate screenshots of PDF pages
   */
  async screenshot(
    filePath: string,
    pageNumbers?: number[],
    quiet = false
  ): Promise<ScreenshotResult[]> {
    const log = (msg: string) => {
      if (!quiet) console.error(msg); // Progress goes to stderr
    };

    log(`Generating screenshots for: ${filePath}`);

    // Load PDF document to get page count and dimensions
    const doc = await this.pdfEngine.loadDocument(filePath);
    const totalPages = doc.numPages;

    const results: ScreenshotResult[] = [];
    const pages = pageNumbers || Array.from({ length: totalPages }, (_, i) => i + 1);

    // Initialize PDFium renderer
    const renderer = new PdfiumRenderer();

    try {
      for (const pageNum of pages) {
        if (pageNum < 1 || pageNum > totalPages) {
          console.error(`Skipping invalid page number: ${pageNum}`);
          continue;
        }

        log(`Rendering page ${pageNum}...`);
        const imageBuffer = await renderer.renderPageToBuffer(filePath, pageNum, this.config.dpi);

        // Get page dimensions
        const pageData = await this.pdfEngine.extractPage(doc, pageNum);

        results.push({
          pageNum,
          width: pageData.width,
          height: pageData.height,
          imageBuffer,
        });
      }
    } finally {
      // Clean up resources
      await renderer.close();
      await this.pdfEngine.close(doc);
    }

    log(`Generated ${results.length} screenshots`);
    return results;
  }

  /**
   * Run OCR on pages that need it (in parallel with concurrency limit)
   */
  private async runOCR(
    doc: PdfDocument,
    pages: PageData[],
    log: (msg: string) => void
  ): Promise<void> {
    if (!this.ocrEngine) return;

    log(`Running OCR on pages (concurrency: ${this.config.numWorkers})...`);

    const limit = pLimit(this.config.numWorkers);

    await Promise.all(
      pages.map((page) => limit(() => this.processPageOcr(doc, page, log)))
    );
  }

  /**
   * Process OCR for a single page
   */
  private async processPageOcr(
    doc: PdfDocument,
    page: PageData,
    log: (msg: string) => void
  ): Promise<void> {
    if (!this.ocrEngine) return;

    // Check if page has very little text (indicating need for OCR)
    const textLength = page.textItems.reduce(
      (sum: number, item: TextItem) => sum + item.str.length,
      0
    );

    // Determine if OCR is needed and what mode
    const hasGarbledRegions = page.garbledTextRegions && page.garbledTextRegions.length > 0;
    const needsFullOcr = textLength < 100 || page.images.length > 0;

    if (!needsFullOcr && !hasGarbledRegions) {
      return;
    }

    try {
      // Render page as image
      const imageBuffer = await this.pdfEngine.renderPageImage(
        doc,
        page.pageNum,
        this.config.dpi
      );

      // Save temporary image file
      const fs = await import("fs/promises");
      const path = await import("path");
      const os = await import("os");
      const tmpDir = os.tmpdir();
      const tmpImagePath = path.join(tmpDir, `page_${page.pageNum}_ocr.png`);
      await fs.writeFile(tmpImagePath, imageBuffer);

      // Run OCR
      log(`  OCR on page ${page.pageNum}...`);
      const ocrResults = await this.ocrEngine.recognize(tmpImagePath, {
        language: this.config.ocrLanguage,
        correctRotation: true,
      });

      // Convert OCR results to text items and add to page
      if (ocrResults.length > 0) {
        // Scale factor to convert from OCR pixels to PDF points
        // OCR operates at config.dpi, PDF uses 72 points per inch (PDF spec constant)
        const scaleFactor = 72 / this.config.dpi;

        // Helper to check if an OCR result overlaps with garbled regions
        const overlapsGarbledRegion = (ocrBbox: number[]): boolean => {
          if (!page.garbledTextRegions) return false;

          const ocrX = ocrBbox[0] * scaleFactor;
          const ocrY = ocrBbox[1] * scaleFactor;
          const ocrW = (ocrBbox[2] - ocrBbox[0]) * scaleFactor;
          const ocrH = (ocrBbox[3] - ocrBbox[1]) * scaleFactor;

          // Check overlap with any garbled region (with some tolerance)
          const tolerance = 5; // PDF points
          for (const region of page.garbledTextRegions) {
            const overlapX =
              ocrX < region.x + region.width + tolerance && ocrX + ocrW > region.x - tolerance;
            const overlapY =
              ocrY < region.y + region.height + tolerance && ocrY + ocrH > region.y - tolerance;
            if (overlapX && overlapY) {
              return true;
            }
          }
          return false;
        };

        // Helper to check if an OCR result spatially overlaps with existing PDF text
        // This prevents duplicating text that PDF already extracted correctly
        const overlapsExistingText = (ocrBbox: number[]): boolean => {
          const ocrX = ocrBbox[0] * scaleFactor;
          const ocrY = ocrBbox[1] * scaleFactor;
          const ocrW = (ocrBbox[2] - ocrBbox[0]) * scaleFactor;
          const ocrH = (ocrBbox[3] - ocrBbox[1]) * scaleFactor;

          const tolerance = 2; // PDF points - tighter tolerance for existing text
          for (const item of page.textItems) {
            const itemRight = item.x + (item.width || item.w || 0);
            const itemBottom = item.y + (item.height || item.h || 0);

            const overlapX = ocrX < itemRight + tolerance && ocrX + ocrW > item.x - tolerance;
            const overlapY = ocrY < itemBottom + tolerance && ocrY + ocrH > item.y - tolerance;

            if (overlapX && overlapY) {
              return true;
            }
          }
          return false;
        };

        const ocrTextItems: TextItem[] = ocrResults
          .filter((r) => r.confidence > 0.1) // Filter low confidence
          .filter((r) => {
            // For targeted OCR (garbled regions only), only include results that overlap
            if (hasGarbledRegions && !needsFullOcr) {
              return overlapsGarbledRegion(r.bbox);
            }
            // For full OCR, include all results
            return true;
          })
          .filter((r) => {
            // Skip OCR results that spatially overlap with existing PDF text
            // This prevents duplicating text that PDF already extracted correctly
            return !overlapsExistingText(r.bbox);
          })
          .map((r) => ({
            str: r.text,
            x: r.bbox[0] * scaleFactor,
            y: r.bbox[1] * scaleFactor,
            width: (r.bbox[2] - r.bbox[0]) * scaleFactor,
            height: (r.bbox[3] - r.bbox[1]) * scaleFactor,
            w: (r.bbox[2] - r.bbox[0]) * scaleFactor,
            h: (r.bbox[3] - r.bbox[1]) * scaleFactor,
            fontName: "OCR",
            fontSize: (r.bbox[3] - r.bbox[1]) * scaleFactor,
          }));

        // Add OCR text items directly to page textItems
        page.textItems.push(...ocrTextItems);
        log(`  Found ${ocrTextItems.length} text items from OCR on page ${page.pageNum}`);
      }

      // Clean up temp file
      await fs.unlink(tmpImagePath).catch(() => {});
    } catch (error) {
      log(`  OCR failed for page ${page.pageNum}: ${error}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): LiteParseConfig {
    return { ...this.config };
  }
}
