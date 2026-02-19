import { vi, describe, it, expect } from "vitest";
import { PdfiumRenderer } from "./pdfium-renderer";

const mockPDFiumPageRender = {
  width: 612,
  height: 792,
  originalWidth: 612,
  originalHeight: 792,
  data: new Uint8Array(612 * 792 * 4),
};

const mockPdfiumPage = {
  render: vi.fn(async () => {
    return mockPDFiumPageRender;
  }),
};

const mockPdfiumDoc = {
  getPage: vi.fn(() => {
    return mockPdfiumPage;
  }),
  destroy: vi.fn(),
};

const mockPdfiumLibrary = {
  loadDocument: vi
    .fn()
    .mockImplementationOnce(async () => {
      return mockPdfiumDoc;
    })
    .mockImplementationOnce(async () => {
      throw new Error("loading error");
    }),
  close: vi.fn(async () => {}),
};

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      readFile: vi.fn(async () => {
        return Buffer.from("mock file content");
      }),
    },
  };
});

vi.mock("@hyzyla/pdfium", async () => {
  const actual = await vi.importActual<typeof import("@hyzyla/pdfium")>("@hyzyla/pdfium");
  return {
    ...actual,
    PDFiumLibrary: vi.fn(
      class {
        constructor() {}

        static init() {
          return mockPdfiumLibrary;
        }

        // implement these just to be on the safe side
        loadDocument = vi
          .fn()
          .mockImplementationOnce(async () => {
            return mockPdfiumDoc;
          })
          .mockImplementationOnce(async () => {
            throw new Error("loading error");
          });
        close = vi.fn(async () => {});
      }
    ),
  };
});

describe("test renderPageToBuffer", () => {
  it("test success", async () => {
    const renderer = new PdfiumRenderer();
    const result = await renderer.renderPageToBuffer("test.pdf", 1);
    expect(result).toStrictEqual(Buffer.from(mockPDFiumPageRender.data));
  });

  it("test error propagation", async () => {
    const renderer = new PdfiumRenderer();
    expect(renderer.renderPageToBuffer("test.pdf", 1)).rejects.toThrow("loading error");
  });
});
