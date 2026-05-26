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

  lines.push("## Segments", "");
  for (const segment of result.segments || []) {
    lines.push(`### ${segment.location}`, "");
    lines.push("**Original**", "");
    lines.push(segment.sourceText || "", "");
    lines.push("**Translation**", "");
    lines.push(segment.translatedText || "", "");
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
