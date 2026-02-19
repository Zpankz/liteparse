/**
 * Compares current liteparse output against a baseline dataset
 *
 * Usage:
 *   npx tsx scripts/compare-dataset.ts [dataset-dir]
 *
 * The dataset should be created using create-dataset.ts and contains:
 *   - documents/: The original document files
 *   - metadata.jsonl: Expected outputs for each document/page
 *
 * Exit codes:
 *   0 - No changes detected
 *   1 - Changes detected (requires approval)
 *   2 - Error occurred
 *
 * For CI/CD, this script can be run to detect if a PR changes output.
 * If changes are detected, the PR should require manual approval.
 */

import { LiteParse } from "../src/lib.js";
import * as fs from "fs/promises";
import * as path from "path";

const DEFAULT_DATASET_DIR = path.join(import.meta.dirname, "..", "dataset");

interface DatasetRow {
  file_name: string;
  document: string;
  page: number;
  output_text: string;
  output_json: object;
}

interface DiffResult {
  document: string;
  page: number;
  type: "added" | "removed" | "changed";
  expected?: string;
  actual?: string;
  diff?: string;
}

async function loadDataset(datasetDir: string): Promise<Map<string, DatasetRow>> {
  const metadataPath = path.join(datasetDir, "metadata.jsonl");
  const content = await fs.readFile(metadataPath, "utf-8");
  const rows = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DatasetRow);

  const map = new Map<string, DatasetRow>();
  for (const row of rows) {
    const key = `${row.document}:${row.page}`;
    map.set(key, row);
  }

  return map;
}

/**
 * Normalize text for comparison - handles cross-platform LibreOffice differences.
 * Collapses whitespace runs to single space and trims each line.
 */
function normalizeForComparison(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function computeTextDiff(expected: string, actual: string): string {
  // Simple line-by-line diff
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const diff: string[] = [];

  const maxLines = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < maxLines; i++) {
    const exp = expectedLines[i] ?? "";
    const act = actualLines[i] ?? "";

    if (exp !== act) {
      if (exp && !act) {
        diff.push(`- ${exp}`);
      } else if (!exp && act) {
        diff.push(`+ ${act}`);
      } else {
        diff.push(`- ${exp}`);
        diff.push(`+ ${act}`);
      }
    }
  }

  return diff.slice(0, 20).join("\n") + (diff.length > 20 ? `\n... (${diff.length - 20} more)` : "");
}

async function getCurrentOutput(
  filePath: string
): Promise<Map<number, { text: string; json: object }>> {
  const parser = new LiteParse({
    outputFormat: "json",
    ocrEnabled: false,
    preciseBoundingBox: true,
  });

  const result = await parser.parse(filePath, true);
  const outputs = new Map<number, { text: string; json: object }>();

  if (result.pages.length === 0 && result.text) {
    // Text-only result
    outputs.set(1, { text: result.text, json: { text: result.text } });
  } else {
    for (const page of result.pages) {
      const jsonPage = result.json?.pages.find((p) => p.page === page.pageNum);
      outputs.set(page.pageNum, {
        text: page.text,
        json: jsonPage || { page: page.pageNum, text: page.text },
      });
    }
  }

  return outputs;
}

async function main() {
  const datasetDir = process.argv[2] || DEFAULT_DATASET_DIR;
  const documentsDir = path.join(datasetDir, "documents");

  console.log("LiteParse Dataset Comparison");
  console.log("============================");
  console.log(`Dataset: ${datasetDir}`);
  console.log(`Documents: ${documentsDir}`);
  console.log();

  // Load expected dataset
  let expected: Map<string, DatasetRow>;
  try {
    expected = await loadDataset(datasetDir);
    console.log(`Loaded ${expected.size} expected entries\n`);
  } catch (error) {
    console.error(`Failed to load dataset: ${error}`);
    process.exit(2);
  }

  const diffs: DiffResult[] = [];
  const processedKeys = new Set<string>();

  // Group expected entries by document
  const docEntries = new Map<string, DatasetRow[]>();
  for (const row of expected.values()) {
    const existing = docEntries.get(row.document) || [];
    existing.push(row);
    docEntries.set(row.document, existing);
  }

  // Process each document
  for (const [document, rows] of docEntries) {
    const filePath = path.join(documentsDir, document);

    // Check if file still exists
    try {
      await fs.access(filePath);
    } catch {
      // File removed
      for (const row of rows) {
        const key = `${row.document}:${row.page}`;
        processedKeys.add(key);
        diffs.push({
          document: row.document,
          page: row.page,
          type: "removed",
          expected: row.output_text,
        });
      }
      continue;
    }

    console.log(`Checking: ${document}`);

    try {
      const currentOutputs = await getCurrentOutput(filePath);

      // Compare each page
      for (const row of rows) {
        const key = `${row.document}:${row.page}`;
        processedKeys.add(key);

        const current = currentOutputs.get(row.page);
        if (!current) {
          diffs.push({
            document: row.document,
            page: row.page,
            type: "removed",
            expected: row.output_text,
          });
          continue;
        }

        // Compare text output
        // For non-PDF files (PPTX, DOCX, etc.), normalize whitespace because
        // LibreOffice conversion produces different spacing across platforms.
        // For PDFs, use strict comparison since they're parsed directly.
        const expectedText = row.output_text.trim();
        const actualText = current.text.trim();
        const isPdf = row.document.toLowerCase().endsWith(".pdf");

        const expectedCompare = isPdf ? expectedText : normalizeForComparison(expectedText);
        const actualCompare = isPdf ? actualText : normalizeForComparison(actualText);

        if (expectedCompare !== actualCompare) {
          diffs.push({
            document: row.document,
            page: row.page,
            type: "changed",
            expected: expectedText,
            actual: actualText,
            diff: computeTextDiff(expectedText, actualText),
          });
        }

        currentOutputs.delete(row.page);
      }

      // Check for new pages
      for (const [pageNum, output] of currentOutputs) {
        diffs.push({
          document,
          page: pageNum,
          type: "added",
          actual: output.text,
        });
      }
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : error}`);
      // Check if it was an expected error
      const errorRow = rows.find(
        (r) => (r.output_json as { error?: boolean }).error === true
      );
      if (!errorRow) {
        diffs.push({
          document,
          page: 0,
          type: "changed",
          expected: "successful parse",
          actual: `error: ${error instanceof Error ? error.message : error}`,
        });
      }
      for (const row of rows) {
        processedKeys.add(`${row.document}:${row.page}`);
      }
    }
  }

  // Report results
  console.log();
  console.log("Results");
  console.log("-------");

  if (diffs.length === 0) {
    console.log("✓ No changes detected");
    process.exit(0);
  }

  console.log(`✗ ${diffs.length} change(s) detected:\n`);

  for (const diff of diffs) {
    console.log(`[${diff.type.toUpperCase()}] ${diff.document} (page ${diff.page})`);
    if (diff.diff) {
      console.log(diff.diff);
    }
    console.log();
  }

  // Output summary for CI
  console.log("---");
  console.log("SUMMARY:");
  console.log(`  Added: ${diffs.filter((d) => d.type === "added").length}`);
  console.log(`  Removed: ${diffs.filter((d) => d.type === "removed").length}`);
  console.log(`  Changed: ${diffs.filter((d) => d.type === "changed").length}`);
  console.log();
  console.log("This PR changes liteparse output and requires manual approval.");

  process.exit(1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
