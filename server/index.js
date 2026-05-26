import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { createJob, getJob, listJobs, toPublicJob, updateJob } from "./lib/jobs.js";
import { buildDocx, buildMarkdown } from "./services/exporters.js";
import { extractDocument } from "./services/extractors.js";
import { translateSegments } from "./services/translator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const uploadDir = process.env.UPLOAD_DIR || path.join(rootDir, "uploads");
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === "production";

await fs.mkdir(uploadDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_request, file, callback) => {
    const safeName = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    callback(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 80) * 1024 * 1024
  }
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "ppt-translate",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/languages", (_request, response) => {
  response.json({
    languages: [
      { code: "zh", label: "中文" },
      { code: "en", label: "English" },
      { code: "ja", label: "日本語" },
      { code: "ko", label: "한국어" },
      { code: "fr", label: "Français" },
      { code: "de", label: "Deutsch" },
      { code: "es", label: "Español" }
    ],
    directions: [
      { source: "zh", target: "en", label: "中译英" },
      { source: "en", target: "zh", label: "英译中" }
    ]
  });
});

app.get("/api/jobs", (_request, response) => {
  response.json({ jobs: listJobs() });
});

app.get("/api/jobs/:id", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) {
    response.status(404).json({ error: "Job not found" });
    return;
  }
  response.json({ job: toPublicJob(job) });
});

app.post("/api/uploads", upload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "File is required" });
    return;
  }

  const extension = path.extname(request.file.originalname).toLowerCase();
  if (![".pptx", ".pdf"].includes(extension)) {
    await fs.rm(request.file.path, { force: true });
    response.status(400).json({ error: "Only PPTX and PDF files are supported" });
    return;
  }

  const job = createJob({
    filename: request.file.originalname,
    storedFilename: request.file.filename,
    filepath: request.file.path,
    mimetype: request.file.mimetype,
    sourceLang: request.body.sourceLang || "zh",
    targetLang: request.body.targetLang || "en",
    ocrMode: request.body.ocrMode || "auto"
  });

  response.status(202).json({ job: toPublicJob(job) });
  queueMicrotask(() => processJob(job.id));
});

app.get("/api/jobs/:id/export", async (request, response) => {
  const job = getJob(request.params.id);
  if (!job) {
    response.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "completed") {
    response.status(409).json({ error: "Job is not completed" });
    return;
  }

  const format = String(request.query.format || "json").toLowerCase();
  const baseName = path.basename(job.filename, path.extname(job.filename)).replace(/[^\w.-]/g, "_");

  if (format === "markdown" || format === "md") {
    response.setHeader("Content-Type", "text/markdown; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${baseName}.translated.md"`);
    response.send(buildMarkdown(job));
    return;
  }

  if (format === "docx") {
    const docx = await buildDocx(job);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    response.setHeader("Content-Disposition", `attachment; filename="${baseName}.translated.docx"`);
    response.send(docx);
    return;
  }

  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${baseName}.translated.json"`);
  response.send(JSON.stringify(toPublicJob(job), null, 2));
});

if (isProduction) {
  const clientDir = path.join(rootDir, "dist/client");
  app.use(express.static(clientDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDir, "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  const status = error instanceof multer.MulterError ? 400 : 500;
  response.status(status).json({ error: error.message || "Internal server error" });
});

app.listen(port, () => {
  console.log(`PPT-Translate API listening on http://localhost:${port}`);
});

async function processJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  try {
    updateJob(jobId, {
      status: "processing",
      progress: 15,
      message: "正在抽取文本和 OCR"
    });

    const extracted = await extractDocument(job);

    updateJob(jobId, {
      progress: 62,
      message: "正在翻译"
    });

    const translatedSegments = await translateSegments(
      extracted.segments,
      job.sourceLang,
      job.targetLang
    );

    const warnings = [...(extracted.warnings || [])];
    if (translatedSegments.some((segment) => segment.provider === "unconfigured")) {
      warnings.push("No translation provider is configured, so original text was preserved.");
    }

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: "处理完成",
      result: {
        ...extracted,
        warnings,
        segments: translatedSegments,
        completedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      message: "处理失败",
      error: error.message
    });
  }
}
