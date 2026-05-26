import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx, buildMarkdown, buildPdf } from "./exporters.js";
import { extractDocument, textContentToLines } from "./extractors.js";
import {
  applyFormulaGuard,
  checkFormulaConsistency,
  prepareSegmentsForTranslation
} from "./formulaGuard.js";
import { createRedrawnFigure } from "./redraw.js";
import { getGlossary, getModelKeyStatus, updateGlossary, updateModelKeys } from "./runtimeConfig.js";
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
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
          Target="../media/image1.png"/>
      </Relationships>`
    );
    zip.file(
      "ppt/media/image1.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      )
    );

    await fs.writeFile(filepath, await zip.generateAsync({ type: "nodebuffer" }));
    const assetDir = path.join(tempDir, "assets");

    const result = await extractDocument({
      filepath,
      filename: "sample.pptx",
      mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ocrMode: "text",
      jobId: "job_1",
      assetDir
    });

    expect(result.type).toBe("pptx");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].sourceText).toBe("项目目标");
    expect(result.segments[1].sourceText).toContain("导出译文");
    expect(result.images).toHaveLength(1);
    expect(result.images[0].originalImageUrl).toBe(`/api/jobs/job_1/images/${result.images[0].id}/original`);
    expect(result.images[0].ocrProvider).toBe("skipped");
    await expect(fs.stat(path.join(assetDir, result.images[0].assetFilename))).resolves.toBeTruthy();
  });

  it("orders two-column PDF text by column instead of row interleaving", () => {
    const items = [
      { str: "Paper Title", transform: [1, 0, 0, 1, 80, 760], width: 440 }
    ];

    for (let index = 0; index < 9; index += 1) {
      const y = 720 - index * 16;
      items.push(
        { str: `left-${index}`, transform: [1, 0, 0, 1, 50, y], width: 80 },
        { str: `right-${index}`, transform: [1, 0, 0, 1, 340, y], width: 90 }
      );
    }

    const output = textContentToLines(items, 600);
    expect(output.indexOf("left-8")).toBeLessThan(output.indexOf("right-0"));
    expect(output).not.toContain("left-0 right-0");
  });

  it("preserves text when no translation provider is configured", async () => {
    const openaiKey = process.env.OPENAI_API_KEY;
    const deeplKey = process.env.DEEPL_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPL_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    updateModelKeys({
      clearOpenAI: true,
      clearDeepSeek: true,
      preferredProvider: "auto"
    });

    const translated = await translateSegments(
      [{ id: "seg_1", location: "Slide 1", sourceText: "Hello world" }],
      "en",
      "zh"
    );

    if (openaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = openaiKey;
    if (deeplKey === undefined) delete process.env.DEEPL_API_KEY;
    else process.env.DEEPL_API_KEY = deeplKey;
    if (deepseekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = deepseekKey;

    expect(translated[0].translatedText).toBe("Hello world");
    expect(translated[0].provider).toBe("unconfigured");
  });

  it("restores formulas exactly after placeholder translation", () => {
    const [prepared] = prepareSegmentsForTranslation([
      {
        id: "seg_formula",
        location: "Page 3",
        sourceText: "Where:\nρ = 0,38 if 1140 ≤ t ≤ 1259\nPMax ≥ PGt"
      }
    ]);

    expect(prepared.sourceText).toContain("[[FORMULA_");

    const translated = applyFormulaGuard(
      { ...prepared, provider: "mock" },
      "其中：\n[[FORMULA_0]]\n[[FORMULA_1]]"
    );

    expect(translated.translatedText).toContain("ρ = 0,38 if 1140 ≤ t ≤ 1259");
    expect(translated.translatedText).toContain("PMax ≥ PGt");
    expect(translated.formulaCheck.ok).toBe(true);
  });

  it("reports formula mismatches", () => {
    const check = checkFormulaConsistency("ρ = 0,38 if 1140 ≤ t ≤ 1259", "其中：价格为 0.38");
    expect(check.ok).toBe(false);
    expect(check.missingFormulaCount).toBe(1);
  });

  it("masks runtime model keys", () => {
    const status = updateModelKeys({
      preferredProvider: "deepseek",
      deepseekApiKey: "sk-deepseek-test-key",
      deepseekModel: "deepseek-v4-flash",
      mathpixAppId: "test-mathpix-id",
      mathpixAppKey: "test-mathpix-secret"
    });

    expect(status.preferredProvider).toBe("deepseek");
    expect(status.deepseek.configured).toBe(true);
    expect(status.deepseek.keyPreview).toBe("sk-...-key");
    expect(status.mathpix.configured).toBe(true);
    expect(status.mathpix.appIdPreview).toBe("tes...x-id");
    expect(JSON.stringify(getModelKeyStatus())).not.toContain("deepseek-test");
    expect(JSON.stringify(getModelKeyStatus())).not.toContain("mathpix-secret");

    updateModelKeys({ clearDeepSeek: true, clearMathpix: true, preferredProvider: "auto" });
  });

  it("stores glossary terms for translation prompts", () => {
    const glossary = updateGlossary({
      terms: [
        { source: "smart grid", target: "智能电网", note: "domain" },
        { source: "", target: "ignored" }
      ]
    });

    expect(glossary.terms).toEqual([
      { source: "smart grid", target: "智能电网", note: "domain" }
    ]);
    expect(getGlossary().terms[0].target).toBe("智能电网");

    updateGlossary({ terms: [] });
  });

  it("exports completed jobs as Markdown, DOCX, and PDF", async () => {
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

    const pdf = await buildPdf(job);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("creates editable SVG for an OCR image redraw", () => {
    const svg = createRedrawnFigure({
      image: {
        location: "Slide 2 Image 1",
        ocrText: "原图文字",
        translatedOcrText: "Translated figure text"
      }
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("Translated figure text");
    expect(svg).toContain("Slide 2 Image 1");
  });
});
