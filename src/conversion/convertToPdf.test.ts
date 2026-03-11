import { vi, describe, it, expect } from "vitest";
import { EventEmitter } from "events";

const mockFd = {
  read: vi.fn(),
  close: vi.fn(),
};

const mockProc = {
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  kill: vi.fn(),
  on: vi.fn(),
};

vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockProc),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      open: vi.fn(async () => {
        return mockFd;
      }),
      access: vi.fn(async (path: string, _mode?: number) => {
        console.log(path);
        const toErrorPath = [
          "/Applications/LibreOffice.app/Contents/MacOS/soffice",
          "/Applications/LibreOffice.app/Contents/MacOS/libreoffice",
          "C:\\Program Files\\Libreoffice\\program\\soffice.exe",
          "./test_fail.pdf",
          "test_fail.pdf",
          "test.docx",
        ];
        if (toErrorPath.includes(path)) {
          throw new Error("unaccessible");
        }
        return;
      }),
      mkdtemp: vi.fn(async () => {
        return "/tmp/test";
      }),
      readFile: vi.fn(async () => {
        return "hello world";
      }),
    },
  };
});

import {
  guessFileExtension,
  findImageMagickCommand,
  findLibreOfficeCommand,
  convertOfficeDocument,
  convertImageToPdf,
  convertToPdf,
} from "./convertToPdf";

describe("test guessFileExtension", () => {
  it("detects PDF", async () => {
    mockFd.read.mockImplementation((buffer: Buffer) => {
      Buffer.from("%PDF").copy(buffer);
    });

    expect(await guessFileExtension("/some/file")).toBe(".pdf");
  });

  it("detects PNG", async () => {
    mockFd.read.mockImplementation((buffer: Buffer) => {
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer);
    });

    expect(await guessFileExtension("/some/file")).toBe(".png");
  });

  it("returns extension directly if present", async () => {
    expect(await guessFileExtension("/some/file.pdf")).toBe(".pdf");
  });
});

describe("test command availability", () => {
  it("libreoffice available", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "/opt/bin/libreoffice");
    const result = await findLibreOfficeCommand();
    expect(result).toBe("libreoffice");
  });

  it("libreoffice not available", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(1);
    });
    mockProc.stderr.emit("data", "command not found");
    // does not throw
    const result = await findLibreOfficeCommand();
    expect(result).toBeNull();
  });

  it("imagemagick available", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "/opt/bin/libreoffice");
    const result = await findImageMagickCommand();
    expect(result).toStrictEqual({ command: "magick", args: [] });
  });

  it("imagemagick not available", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(1);
    });
    mockProc.stderr.emit("data", "command not found");
    // does not throw
    const result = await findImageMagickCommand();
    expect(result).toBeNull();
  });
});

describe("test convertOfficeDocument", () => {
  it("conversion succeeds", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");

    const result = await convertOfficeDocument("test.docx", "./");
    expect(result).toBe("test.pdf");
  });

  it("conversion fails (command not found)", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(1);
    });
    mockProc.stdout.emit("data", "command not found");

    await expect(convertOfficeDocument("test_command.docx", "./")).rejects.toThrow(
      "LibreOffice is not installed. Please install LibreOffice to convert office documents. On macOS: brew install --cask libreoffice, On Ubuntu: apt-get install libreoffice"
    );
  });

  it("conversion fails (output not found)", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");

    await expect(convertOfficeDocument("test_fail.docx", "./")).rejects.toThrow(
      "LibreOffice conversion succeeded but output PDF not found"
    );
  });
});

describe("test convertImageToPdf", () => {
  it("conversion succeeds", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");

    const result = await convertImageToPdf("test.png", "./");
    expect(result).toBe("test.pdf");
  });

  it("conversion fails (command not found)", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(1);
    });
    mockProc.stdout.emit("data", "command not found");

    await expect(convertImageToPdf("test_command.png", "./")).rejects.toThrow(
      "ImageMagick is not installed. Please install ImageMagick to convert images. On macOS: brew install imagemagick, On Ubuntu: apt-get install imagemagick"
    );
  });
});

describe("test convertToPdf", () => {
  it("convert PDF fails because file not found", async () => {
    const result = await convertToPdf("test.docx");
    expect(result).toStrictEqual({
      message: `File not found: test.docx`,
      code: "FILE_NOT_FOUND",
    });
  });

  it("convert an office document (word)", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");
    const result = await convertToPdf("test_1.docx");
    expect(result).toStrictEqual({
      pdfPath: "/tmp/test/test_1.pdf",
      originalExtension: ".docx",
    });
  });

  it("convert an office document (xlsx)", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");
    const result = await convertToPdf("test.xlsx");
    expect(result).toStrictEqual({
      pdfPath: "/tmp/test/test.pdf",
      originalExtension: ".xlsx",
    });
  });

  it("convert an image", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");
    const result = await convertToPdf("test.png");
    expect(result).toStrictEqual({
      pdfPath: "/tmp/test/test.pdf",
      originalExtension: ".png",
    });
  });

  it("convert a text file", async () => {
    mockProc.on.mockImplementation((event, cb) => {
      if (event === "close") cb(0);
    });
    mockProc.stdout.emit("data", "conversion successfull");
    const result = await convertToPdf("test.txt");
    expect(result).toStrictEqual({
      content: "hello world",
    });
  });
});
