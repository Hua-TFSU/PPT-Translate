import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { nanoid } from "nanoid";
import {
  hasAwsTextractCredentials,
  hasAzureOcrCredentials,
  hasBaiduOcrCredentials,
  recognizeDocumentWithAwsTextract,
  recognizeDocumentWithAzure,
  recognizeDocumentWithBaidu
} from "./cloudOcr.js";
import {
  convertPdfWithMathpix,
  hasMathpixCredentials,
  recognizeImageWithMathpix
} from "./mathpix.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false
});

const imageMimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".webp", "image/webp"]
]);

export async function extractDocument({
  filepath,
  filename,
  mimetype,
  ocrMode = "auto",
  jobId = "",
  assetDir = ""
}) {
  const extension = path.extname(filename).toLowerCase();

  if (extension === ".pptx") {
    return extractPptx(filepath, ocrMode, { jobId, assetDir });
  }

  if (extension === ".pdf" || mimetype === "application/pdf") {
    return extractPdf(filepath, filename, ocrMode);
  }

  throw new Error("Only PPTX and PDF files are supported");
}

async function extractPdf(filepath, filename, ocrMode) {
  const buffer = await fs.readFile(filepath);
  const warnings = [];

  if ((ocrMode === "mathpix" || ocrMode === "auto") && hasMathpixCredentials()) {
    const markdown = await convertPdfWithMathpix(buffer, filename);
    const segments = markdownToSegments(markdown);
    return {
      type: "pdf",
      extractor: "mathpix",
      segments,
      images: [],
      warnings
    };
  }

  if (ocrMode === "mathpix") {
    warnings.push("Mathpix is selected but credentials are not configured.");
  }

  if ((ocrMode === "azure" || ocrMode === "auto") && hasAzureOcrCredentials()) {
    const text = await recognizeDocumentWithAzure(buffer, "application/pdf");
    return {
      type: "pdf",
      extractor: "azure-document-intelligence",
      segments: text ? textToSegments(text, "Azure OCR Block") : [],
      images: [],
      warnings
    };
  }

  if (ocrMode === "azure") {
    warnings.push("Azure AI Document Intelligence is selected but credentials are not configured.");
  }

  if ((ocrMode === "aws" || ocrMode === "auto") && hasAwsTextractCredentials()) {
    const text = await recognizeDocumentWithAwsTextract(buffer);
    return {
      type: "pdf",
      extractor: "aws-textract",
      segments: text ? textToSegments(text, "AWS Textract Block") : [],
      images: [],
      warnings
    };
  }

  if (ocrMode === "aws") {
    warnings.push("AWS Textract is selected but credentials are not configured.");
  }

  if ((ocrMode === "baidu" || ocrMode === "auto") && hasBaiduOcrCredentials()) {
    const text = await recognizeDocumentWithBaidu(buffer, "application/pdf");
    return {
      type: "pdf",
      extractor: "baidu-ocr",
      segments: text ? textToSegments(text, "Baidu OCR Block") : [],
      images: [],
      warnings
    };
  }

  if (ocrMode === "baidu") {
    warnings.push("Baidu OCR is selected but credentials are not configured.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true
  }).promise;

  const segments = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const pageText = textContentToLines(content.items, viewport.width);

    if (pageText.trim()) {
      splitTextBlocks(pageText).forEach((block, index, blocks) => {
        segments.push({
          id: nanoid(8),
          location: blocks.length > 1 ? `Page ${pageNumber}.${index + 1}` : `Page ${pageNumber}`,
          kind: "text",
          sourceText: block
        });
      });
    }
  }

  if (segments.length === 0) {
    warnings.push(
      "No selectable PDF text was found. Configure Mathpix OCR for scanned PDFs or formula-heavy files."
    );
  }

  return {
    type: "pdf",
    extractor: "pdfjs",
    segments,
    images: [],
    warnings
  };
}

export function textContentToLines(items, pageWidth = 0) {
  const normalizedItems = items.filter((item) => item.str?.trim());
  if (pageWidth && isColumnMajorTextStream(normalizedItems, pageWidth)) {
    return streamOrderTextContentToLines(normalizedItems, pageWidth);
  }

  const rows = [];
  for (const item of normalizedItems) {
    const y = item.transform?.[5] || 0;
    const x = item.transform?.[4] || 0;
    const width = item.width || 0;
    const row = findRow(rows, y);
    row.items.push({ x, width, text: item.str });
  }

  const lines = rows.flatMap((row) => splitRowIntoColumnLines(row.items, row.y, pageWidth));
  const twoColumn = hasTwoColumnLayout(lines, pageWidth);
  const orderedLines = twoColumn ? orderTwoColumnLines(lines, pageWidth) : orderLinesTopDown(lines);

  return orderedLines
    .map((line) => line.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isColumnMajorTextStream(items, pageWidth) {
  const midpoint = pageWidth / 2;
  const sides = items
    .map((item) => (item.transform?.[4] || 0) < midpoint)
    .filter((side) => typeof side === "boolean");
  let switches = 0;
  for (let index = 1; index < sides.length; index += 1) {
    if (sides[index] !== sides[index - 1]) switches += 1;
  }
  const leftCount = sides.filter(Boolean).length;
  const rightCount = sides.length - leftCount;
  return leftCount >= 20 && rightCount >= 20 && switches <= 10;
}

function streamOrderTextContentToLines(items, pageWidth) {
  const midpoint = pageWidth / 2;
  const lines = [];
  let current = null;

  for (const item of items) {
    const text = item.str.trim();
    const x = item.transform?.[4] || 0;
    const y = item.transform?.[5] || 0;
    const width = item.width || 0;
    const itemEnd = x + width;
    const sameRow = current && Math.abs(y - current.y) <= 3;
    const crossesToRightColumn =
      sameRow && current.minX < midpoint && x >= midpoint && current.maxX <= midpoint + 5;
    const xReset = sameRow && x < current.lastX - 8;
    const newLine = !current || !sameRow || xReset || crossesToRightColumn;

    if (newLine) {
      if (current) lines.push(finalizeStreamLine(current));
      if (current && y > current.y + 80 && x >= midpoint) {
        lines.push({ text: "" });
      }
      current = { y, minX: x, maxX: itemEnd, lastX: itemEnd, parts: [text] };
    } else {
      current.parts.push(text);
      current.maxX = Math.max(current.maxX, itemEnd);
      current.lastX = itemEnd;
    }
  }

  if (current) lines.push(finalizeStreamLine(current));
  return lines
    .map((line) => line.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finalizeStreamLine(line) {
  return {
    text: dehyphenateLine(
      line.parts
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
  };
}

function findRow(rows, y) {
  const existing = rows.find((row) => Math.abs(row.y - y) <= 3);
  if (existing) return existing;
  const row = { y, items: [] };
  rows.push(row);
  return row;
}

function splitRowIntoColumnLines(items, y, pageWidth) {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  const midpoint = pageWidth ? pageWidth / 2 : 0;

  if (midpoint) {
    const leftItems = sorted.filter((item) => item.x + item.width / 2 < midpoint);
    const rightItems = sorted.filter((item) => item.x + item.width / 2 >= midpoint);
    const maxLeftEnd = Math.max(...leftItems.map((item) => item.x + item.width), 0);
    const minRightStart = Math.min(...rightItems.map((item) => item.x), Number.POSITIVE_INFINITY);

    if (leftItems.length && rightItems.length && minRightStart - maxLeftEnd > 18) {
      return [buildLine(leftItems, y, "left"), buildLine(rightItems, y, "right")].filter(
        (line) => line.text
      );
    }
  }

  return [buildLine(sorted, y, "auto")].filter((line) => line.text);
}

function buildLine(items, y, side) {
  const text = items
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  return {
    y,
    minX,
    maxX,
    side,
    text
  };
}

function hasTwoColumnLayout(lines, pageWidth) {
  if (!pageWidth) return false;
  const midpoint = pageWidth / 2;
  const narrowLines = lines.filter((line) => line.maxX - line.minX < pageWidth * 0.62);
  const leftCount = narrowLines.filter((line) => line.maxX < midpoint + pageWidth * 0.08).length;
  const rightCount = narrowLines.filter((line) => line.minX > midpoint - pageWidth * 0.08).length;
  return leftCount >= 8 && rightCount >= 8;
}

function orderTwoColumnLines(lines, pageWidth) {
  const midpoint = pageWidth / 2;
  const columnLines = lines.filter((line) => line.maxX - line.minX < pageWidth * 0.7);
  const highestColumnY = Math.max(...columnLines.map((line) => line.y), Number.NEGATIVE_INFINITY);
  const preamble = lines.filter(
    (line) => line.y > highestColumnY + 4 || line.maxX - line.minX >= pageWidth * 0.7
  );
  const body = lines.filter((line) => !preamble.includes(line));
  const left = body.filter((line) => line.minX < midpoint);
  const right = body.filter((line) => line.minX >= midpoint);

  return [
    ...orderLinesTopDown(preamble),
    ...orderLinesTopDown(left),
    { text: "" },
    ...orderLinesTopDown(right)
  ];
}

function orderLinesTopDown(lines) {
  return lines
    .slice()
    .sort((a, b) => b.y - a.y || a.minX - b.minX)
    .map((line) => ({ ...line, text: dehyphenateLine(line.text) }));
}

function dehyphenateLine(text) {
  return text.replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}

function splitTextBlocks(text, maxChars = 1400) {
  const blocks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      if (current.trim()) {
        blocks.push(current.trim());
        current = "";
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars && current.trim()) {
      blocks.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

function markdownToSegments(markdown) {
  return textToSegments(markdown, "Markdown Block", "markdown");
}

function textToSegments(text, locationPrefix, kind = "text") {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => ({
    id: nanoid(8),
    location: `${locationPrefix} ${index + 1}`,
    kind,
    sourceText: block
  }));
}

async function extractPptx(filepath, ocrMode, options = {}) {
  const buffer = await fs.readFile(filepath);
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const segments = [];
  const images = [];
  const warnings = [];

  for (const slidePath of slideFiles) {
    const slideXml = await zip.file(slidePath).async("string");
    const slideNumberLabel = slideNumber(slidePath);
    const slide = parser.parse(slideXml);
    const paragraphs = collectParagraphTexts(slide);

    paragraphs.forEach((text, index) => {
      if (!text.trim()) return;
      segments.push({
        id: nanoid(8),
        location: `Slide ${slideNumberLabel}.${index + 1}`,
        kind: "text",
        sourceText: text.trim()
      });
    });

    const slideImages = await extractSlideImages(
      zip,
      slidePath,
      slideNumberLabel,
      ocrMode,
      warnings,
      options
    );
    images.push(...slideImages);
    for (const image of slideImages) {
      if (image.ocrText?.trim()) {
        segments.push({
          id: nanoid(8),
          imageId: image.id,
          location: `${image.location} OCR`,
          kind: "image-ocr",
          sourceText: image.ocrText.trim()
        });
      }
    }
  }

  if (segments.length === 0) {
    warnings.push("No text was extracted from this PPTX.");
  }

  return {
    type: "pptx",
    extractor: "pptx-xml",
    segments,
    images,
    warnings
  };
}

function slideNumber(slidePath) {
  return Number(slidePath.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function collectParagraphTexts(node) {
  const paragraphs = [];

  function visit(value, key = "") {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (!value || typeof value !== "object") return;

    if (key.endsWith(":p") || key === "p") {
      const text = collectTextNodes(value).join("");
      if (text.trim()) paragraphs.push(text);
      return;
    }

    Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
  }

  visit(node);
  return paragraphs;
}

function collectTextNodes(node) {
  const values = [];

  function visit(value, key = "") {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (typeof value === "string" || typeof value === "number") {
      if (key.endsWith(":t") || key === "t") values.push(String(value));
      return;
    }

    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
  }

  visit(node);
  return values;
}

async function extractSlideImages(
  zip,
  slidePath,
  slideNumberLabel,
  ocrMode,
  warnings,
  options = {}
) {
  const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
  const relFile = zip.file(relPath);
  if (!relFile) return [];

  const relXml = await relFile.async("string");
  const rels = parser.parse(relXml);
  const relationships = normalizeArray(rels.Relationships?.Relationship);
  const imageRelationships = relationships.filter((rel) => rel["@_Type"]?.includes("/image"));
  const images = [];

  for (const [index, rel] of imageRelationships.entries()) {
    const target = rel["@_Target"];
    if (!target) continue;
    const imagePath = path.posix.normalize(path.posix.join(path.posix.dirname(slidePath), target));
    const imageFile = zip.file(imagePath);
    if (!imageFile) continue;

    const imageBuffer = await imageFile.async("nodebuffer");
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType = imageMimeTypes.get(extension) || "application/octet-stream";
    const image = {
      id: nanoid(8),
      location: `Slide ${slideNumberLabel} Image ${index + 1}`,
      filename: path.posix.basename(imagePath),
      mimeType,
      size: imageBuffer.length,
      originalImageUrl: "",
      assetFilename: "",
      ocrText: "",
      ocrProvider: ""
    };

    if (options.assetDir && options.jobId) {
      await fs.mkdir(options.assetDir, { recursive: true });
      const assetFilename = `${image.id}${extension || ".img"}`;
      await fs.writeFile(path.join(options.assetDir, assetFilename), imageBuffer);
      image.assetFilename = assetFilename;
      image.originalImageUrl = `/api/jobs/${options.jobId}/images/${image.id}/original`;
    }

    const shouldUseMathpix = (ocrMode === "mathpix" || ocrMode === "auto") && hasMathpixCredentials();
    const shouldUseAzure = (ocrMode === "azure" || ocrMode === "auto") && hasAzureOcrCredentials();
    const shouldUseAws = (ocrMode === "aws" || ocrMode === "auto") && hasAwsTextractCredentials();
    const shouldUseBaidu = (ocrMode === "baidu" || ocrMode === "auto") && hasBaiduOcrCredentials();
    const shouldUseLocal =
      ocrMode === "local" ||
      (ocrMode === "auto" &&
        process.env.ENABLE_LOCAL_OCR !== "false" &&
        !shouldUseMathpix &&
        !shouldUseAzure &&
        !shouldUseAws &&
        !shouldUseBaidu);

    try {
      if (shouldUseMathpix) {
        image.ocrText = await recognizeImageWithMathpix(imageBuffer, mimeType);
        image.ocrProvider = "mathpix";
      } else if (shouldUseAzure) {
        image.ocrText = await recognizeDocumentWithAzure(imageBuffer, mimeType);
        image.ocrProvider = "azure-document-intelligence";
      } else if (shouldUseAws) {
        image.ocrText = await recognizeDocumentWithAwsTextract(imageBuffer);
        image.ocrProvider = "aws-textract";
      } else if (shouldUseBaidu) {
        image.ocrText = await recognizeDocumentWithBaidu(imageBuffer, mimeType);
        image.ocrProvider = "baidu-ocr";
      } else if (shouldUseLocal) {
        image.ocrText = await recognizeImageWithTesseract(imageBuffer);
        image.ocrProvider = "tesseract.js";
      } else if (["mathpix", "azure", "aws", "baidu"].includes(ocrMode)) {
        image.ocrProvider = "not configured";
      } else {
        image.ocrProvider = "skipped";
        warnings.push(
          `${image.location} OCR skipped. Enable Mathpix credentials or local OCR to recognize image text.`
        );
      }
    } catch (error) {
      image.ocrProvider = "failed";
      warnings.push(`${image.location} OCR failed: ${error.message}`);
    }

    images.push(image);
  }

  return images;
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function recognizeImageWithTesseract(buffer) {
  const { recognize } = await import("tesseract.js");
  const preferredLanguage = process.env.TESSERACT_LANG || "eng+chi_sim";
  try {
    const result = await recognize(buffer, preferredLanguage);
    return result.data?.text || "";
  } catch (error) {
    if (preferredLanguage === "eng") throw error;
    const fallback = await recognize(buffer, "eng");
    return fallback.data?.text || "";
  }
}
