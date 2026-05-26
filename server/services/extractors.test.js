import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx, buildMarkdown } from "./exporters.js";
import { extractDocument } from "./extractors.js";
import { translateSegments } from "./translator.js";

describe("document pipeline", () => {
  it("extracts text from PPTX slide XML", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-translate-"));
    const filepath = path.join(tempDir, "sample.pptx");
    const zip = new JSZip();

    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p><a:r><a:t>项目目标</a:t></a:r></a:p>
                <a:p><a:r><a:t>上传 PPT 和 PDF 后导出译文</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`
    );

    await fs.writeFile(filepath, await zip.generateAsync({ type: "nodebuffer" }));

    const result = await extractDocument({
      filepath,
      filename: "sample.pptx",
      mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ocrMode: "text"
    });

    expect(result.type).toBe("pptx");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].sourceText).toBe("项目目标");
    expect(result.segments[1].sourceText).toContain("导出译文");
  });

  it("preserves text when no translation provider is configured", async () => {
    const openaiKey = process.env.OPENAI_API_KEY;
    const deeplKey = process.env.DEEPL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPL_API_KEY;

    const translated = await translateSegments(
      [{ id: "seg_1", location: "Slide 1", sourceText: "Hello world" }],
      "en",
      "zh"
    );

    process.env.OPENAI_API_KEY = openaiKey;
    process.env.DEEPL_API_KEY = deeplKey;

    expect(translated[0].translatedText).toBe("Hello world");
    expect(translated[0].provider).toBe("unconfigured");
  });

  it("exports completed jobs as Markdown and DOCX", async () => {
    const job = {
      filename: "sample.pptx",
      sourceLang: "zh",
      targetLang: "en",
      status: "completed",
      result: {
        extractor: "pptx-xml",
        warnings: [],
        segments: [
          {
            id: "seg_1",
            location: "Slide 1.1",
            sourceText: "项目目标",
            translatedText: "Project goals"
          }
        ],
        images: []
      }
    };

    expect(buildMarkdown(job)).toContain("Project goals");
    const docx = await buildDocx(job);
    expect(Buffer.isBuffer(docx)).toBe(true);
    expect(docx.length).toBeGreaterThan(1000);
  });
});
