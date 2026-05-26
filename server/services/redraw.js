function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text, maxChars = 34) {
  const normalized = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => {
      const chunks = [];
      let remaining = line.trim();
      while (remaining.length > maxChars) {
        const breakAt = remaining.lastIndexOf(" ", maxChars);
        const index = breakAt > 12 ? breakAt : maxChars;
        chunks.push(remaining.slice(0, index).trim());
        remaining = remaining.slice(index).trim();
      }
      if (remaining) chunks.push(remaining);
      return chunks;
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : ["No OCR text available"];
}

export function createRedrawnFigure({ image, text, title = "Redrawn Figure" }) {
  const lines = wrapText(text || image.translatedOcrText || image.ocrText, 44).slice(0, 12);
  const width = 1280;
  const height = Math.max(720, 220 + lines.length * 54);
  const textStartY = 170;
  const lineHeight = 54;

  const textNodes = lines
    .map((line, index) => {
      const y = textStartY + index * lineHeight;
      return `<text x="96" y="${y}" class="body">${escapeXml(line)}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <style>
      .bg { fill: #f7faf8; }
      .frame { fill: #ffffff; stroke: #b7ccc3; stroke-width: 3; }
      .accent { fill: #287c71; }
      .title { fill: #18201d; font-family: Arial, 'Microsoft YaHei', sans-serif; font-size: 44px; font-weight: 700; }
      .meta { fill: #5c6a65; font-family: Arial, 'Microsoft YaHei', sans-serif; font-size: 24px; }
      .body { fill: #26342f; font-family: Arial, 'Microsoft YaHei', sans-serif; font-size: 34px; }
    </style>
  </defs>
  <rect class="bg" width="${width}" height="${height}" rx="0"/>
  <rect class="frame" x="48" y="48" width="${width - 96}" height="${height - 96}" rx="18"/>
  <rect class="accent" x="78" y="78" width="14" height="${height - 156}" rx="7"/>
  <text x="96" y="112" class="title">${escapeXml(title)}</text>
  <text x="96" y="146" class="meta">${escapeXml(image.location || image.filename || "PPT image")}</text>
  ${textNodes}
</svg>`;
}
