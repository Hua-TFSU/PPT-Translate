import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const chineseFontPath = fileURLToPath(
  new URL(
    "../../node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
    import.meta.url
  )
);

export function buildMarkdown(job) {
  const result = job.result || {};
  const lines = [
    `# ${job.filename} Translation`,
    "",
    `- Source: ${job.sourceLang}`,
    `- Target: ${job.targetLang}`,
    `- Status: ${job.status}`,
    `- Extractor: ${result.extractor || "unknown"}`,
    ""
  ];

  if (result.warnings?.length) {
    lines.push("## Warnings", "");
    result.warnings.forEach((warning) => lines.push(`- ${warning}`));
    lines.push("");
  }

  if (result.formulaSummary) {
    lines.push("## Formula Consistency", "");
    lines.push(`- OK: ${result.formulaSummary.ok}`);
    lines.push(`- Checked segments: ${result.formulaSummary.checkedSegments}`);
    lines.push(`- Source formulas: ${result.formulaSummary.totalFormulas}`);
    lines.push(`- Missing formulas: ${result.formulaSummary.missingFormulas}`);
    lines.push("");
  }

  lines.push("## Segments", "");
  for (const segment of result.segments || []) {
    lines.push(`### ${segment.location}`, "");
    lines.push("**Original**", "");
    lines.push(segment.sourceText || "", "");
    lines.push("**Translation**", "");
    lines.push(segment.translatedText || "", "");
    if (segment.formulaCheck) {
      lines.push(
        `Formula check: ${segment.formulaCheck.ok ? "OK" : "Mismatch"} (${segment.formulaCheck.sourceFormulaCount} source formulas, ${segment.formulaCheck.missingFormulaCount} missing)`,
        ""
      );
    }
  }

  if (result.images?.length) {
    lines.push("## Image OCR", "");
    for (const image of result.images) {
      lines.push(`### ${image.location}`, "");
      lines.push(`- Provider: ${image.ocrProvider || "none"}`);
      lines.push(`- File: ${image.filename}`);
      if (image.redrawnSvgPath) lines.push(`- Redrawn SVG: ${image.redrawnSvgPath}`);
      lines.push("");
      lines.push(image.ocrText || "No OCR text", "");
      if (image.translatedOcrText) {
        lines.push("**Translated OCR**", "");
        lines.push(image.translatedOcrText, "");
      }
    }
  }

  return lines.join("\n");
}

export async function buildDocx(job) {
  const result = job.result || {};
  const children = [
    new Paragraph({
      text: `${job.filename} Translation`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT
    }),
    new Paragraph({
      children: [
        new TextRun(`Source: ${job.sourceLang}  `),
        new TextRun(`Target: ${job.targetLang}  `),
        new TextRun(`Extractor: ${result.extractor || "unknown"}`)
      ]
    })
  ];

  if (result.warnings?.length) {
    children.push(new Paragraph({ text: "Warnings", heading: HeadingLevel.HEADING_1 }));
    for (const warning of result.warnings) {
      children.push(new Paragraph({ text: warning, bullet: { level: 0 } }));
    }
  }

  if (result.formulaSummary) {
    children.push(new Paragraph({ text: "Formula Consistency", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph(`OK: ${result.formulaSummary.ok}`));
    children.push(new Paragraph(`Checked segments: ${result.formulaSummary.checkedSegments}`));
    children.push(new Paragraph(`Source formulas: ${result.formulaSummary.totalFormulas}`));
    children.push(new Paragraph(`Missing formulas: ${result.formulaSummary.missingFormulas}`));
  }

  children.push(new Paragraph({ text: "Segments", heading: HeadingLevel.HEADING_1 }));
  for (const segment of result.segments || []) {
    children.push(new Paragraph({ text: segment.location, heading: HeadingLevel.HEADING_2 }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              tableCell("Original", true),
              tableCell("Translation", true)
            ]
          }),
          new TableRow({
            children: [
              tableCell(segment.sourceText || ""),
              tableCell(segment.translatedText || "")
            ]
          })
        ]
      })
    );
  }

  if (result.images?.length) {
    children.push(new Paragraph({ text: "Image OCR", heading: HeadingLevel.HEADING_1 }));
    for (const image of result.images) {
      children.push(new Paragraph({ text: image.location, heading: HeadingLevel.HEADING_2 }));
      children.push(new Paragraph(`Provider: ${image.ocrProvider || "none"}`));
      children.push(new Paragraph(image.ocrText || "No OCR text"));
      if (image.translatedOcrText) {
        children.push(new Paragraph("Translated OCR"));
        children.push(new Paragraph(image.translatedOcrText));
      }
      if (image.redrawnSvgPath) {
        children.push(new Paragraph(`Redrawn SVG: ${image.redrawnSvgPath}`));
      }
    }
  }

  const document = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBuffer(document);
}

export async function buildPdf(job) {
  const result = job.result || {};
  const doc = new PDFDocument({ margin: 44, size: "A4", bufferPages: true });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  try {
    doc.font(chineseFontPath);
  } catch {
    doc.font("Helvetica");
  }

  doc.fontSize(20).text(`${job.filename} Translation`, { lineGap: 4 });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#4b5b55");
  doc.text(`Source: ${job.sourceLang}   Target: ${job.targetLang}   Extractor: ${result.extractor || "unknown"}`);
  doc.moveDown();

  if (result.warnings?.length) {
    section(doc, "Warnings");
    result.warnings.forEach((warning) => doc.text(`- ${warning}`, { lineGap: 2 }));
    doc.moveDown();
  }

  if (result.formulaSummary) {
    section(doc, "Formula Consistency");
    doc.text(`OK: ${result.formulaSummary.ok}`);
    doc.text(`Checked segments: ${result.formulaSummary.checkedSegments}`);
    doc.text(`Source formulas: ${result.formulaSummary.totalFormulas}`);
    doc.text(`Missing formulas: ${result.formulaSummary.missingFormulas}`);
    doc.moveDown();
  }

  section(doc, "Segments");
  for (const segment of result.segments || []) {
    keepSpace(doc, 140);
    doc.fillColor("#18201d").fontSize(12).text(segment.location, { continued: false });
    doc.moveDown(0.35);
    doc.fillColor("#53615b").fontSize(9).text("Original", { lineGap: 2 });
    doc.fillColor("#26342f").fontSize(10).text(segment.sourceText || "", { lineGap: 2 });
    doc.moveDown(0.35);
    doc.fillColor("#53615b").fontSize(9).text("Translation", { lineGap: 2 });
    doc.fillColor("#111816").fontSize(10).text(segment.translatedText || "", { lineGap: 2 });
    doc.moveDown();
  }

  if (result.images?.length) {
    section(doc, "Image OCR");
    for (const image of result.images) {
      keepSpace(doc, 80);
      doc.fillColor("#18201d").fontSize(12).text(image.location);
      doc.fillColor("#53615b").fontSize(10).text(`Provider: ${image.ocrProvider || "none"}`);
      doc.fillColor("#26342f").fontSize(10).text(image.ocrText || "No OCR text", { lineGap: 2 });
      if (image.translatedOcrText) {
        doc.moveDown(0.25);
        doc.text(image.translatedOcrText, { lineGap: 2 });
      }
      doc.moveDown();
    }
  }

  addPageNumbers(doc);
  doc.end();
  return done;
}

function section(doc, title) {
  keepSpace(doc, 70);
  doc.fillColor("#287c71").fontSize(14).text(title);
  doc.moveDown(0.5);
  doc.fillColor("#26342f");
}

function keepSpace(doc, height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function addPageNumbers(doc) {
  const pageRange = doc.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
    doc.switchToPage(index);
    doc.fillColor("#66736f").fontSize(8).text(
      `${index + 1} / ${pageRange.count}`,
      doc.page.margins.left,
      doc.page.height - 30,
      { align: "center", width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
    );
  }
}

function tableCell(text, bold = false) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold })]
      })
    ]
  });
}
