import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { nanoid } from "nanoid";
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
    const pageText = textContentToLines(content.items);

    if (pageText.trim()) {
      segments.push({
        id: nanoid(8),
        location: `Page ${pageNumber}`,
        kind: "text",
        sourceText: pageText.trim()
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

function textContentToLines(items) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform?.[5] || 0);
    const x = item.transform?.[4] || 0;
    const row = rows.get(y) || [];
    row.push({ x, text: item.str });
    rows.set(y, row);
  }

  return Array.from(rows.entries())
    .sort(([a], [b]) => b - a)
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

function markdownToSegments(markdown) {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => ({
    id: nanoid(8),
    location: `Markdown Block ${index + 1}`,
    kind: "markdown",
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
    const shouldUseLocal =
      ocrMode === "local" ||
      (ocrMode === "auto" && process.env.ENABLE_LOCAL_OCR !== "false");

    try {
      if (shouldUseMathpix) {
        image.ocrText = await recognizeImageWithMathpix(imageBuffer, mimeType);
        image.ocrProvider = "mathpix";
      } else if (shouldUseLocal) {
        image.ocrText = await recognizeImageWithTesseract(imageBuffer);
        image.ocrProvider = "tesseract.js";
      } else if (ocrMode === "mathpix") {
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
