import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Languages,
  Loader2,
  RefreshCcw,
  UploadCloud
} from "lucide-react";

const directions = [
  { label: "中译英", source: "zh", target: "en" },
  { label: "英译中", source: "en", target: "zh" }
];

const ocrModes = [
  { label: "自动", value: "auto" },
  { label: "Mathpix", value: "mathpix" },
  { label: "本地 OCR", value: "local" },
  { label: "仅文本", value: "text" }
];

function statusLabel(status) {
  return {
    queued: "排队中",
    processing: "处理中",
    completed: "已完成",
    failed: "失败"
  }[status] || status;
}

function App() {
  const [file, setFile] = useState(null);
  const [direction, setDirection] = useState(directions[0]);
  const [ocrMode, setOcrMode] = useState("auto");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [redrawingId, setRedrawingId] = useState("");
  const [jobs, setJobs] = useState([]);
  const [keyStatus, setKeyStatus] = useState(null);
  const [keyForm, setKeyForm] = useState({
    preferredProvider: "auto",
    openaiApiKey: "",
    openaiModel: "gpt-4.1-mini",
    deepseekApiKey: "",
    deepseekModel: "deepseek-v4-flash"
  });
  const [isSavingKeys, setIsSavingKeys] = useState(false);
  const fileInputRef = useRef(null);

  const canExport = job?.status === "completed";
  const segments = useMemo(() => job?.result?.segments || [], [job]);
  const imageItems = useMemo(() => job?.result?.images || [], [job]);
  const formulaSummary = job?.result?.formulaSummary;

  async function refreshJobs() {
    const response = await fetch("/api/jobs");
    if (response.ok) {
      const payload = await response.json();
      setJobs(payload.jobs || []);
    }
  }

  useEffect(() => {
    refreshJobs().catch(() => undefined);
    refreshKeyStatus().catch(() => undefined);
  }, []);

  async function refreshKeyStatus() {
    const response = await fetch("/api/settings/model-keys");
    if (response.ok) {
      const payload = await response.json();
      setKeyStatus(payload);
      setKeyForm((current) => ({
        ...current,
        preferredProvider: payload.preferredProvider || "auto",
        openaiModel: payload.openai?.model || current.openaiModel,
        deepseekModel: payload.deepseek?.model || current.deepseekModel
      }));
    }
  }

  useEffect(() => {
    if (!job?.id || ["completed", "failed"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`);
      if (response.ok) {
        const payload = await response.json();
        setJob(payload.job);
        refreshJobs().catch(() => undefined);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  async function upload() {
    if (!file) {
      setError("请选择 PPTX 或 PDF 文件");
      return;
    }

    setError("");
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("sourceLang", direction.source);
    formData.append("targetLang", direction.target);
    formData.append("ocrMode", ocrMode);

    try {
      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "上传失败");
      setJob(payload.job);
      refreshJobs().catch(() => undefined);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function loadJob(jobId) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const payload = await response.json();
    if (response.ok) setJob(payload.job);
  }

  function exportUrl(format) {
    return job?.id ? `/api/jobs/${job.id}/export?format=${format}` : "#";
  }

  async function saveKeys(event) {
    event.preventDefault();
    setIsSavingKeys(true);
    setError("");

    try {
      const response = await fetch("/api/settings/model-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyForm)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存 Key 失败");
      setKeyStatus(payload);
      setKeyForm((current) => ({
        ...current,
        openaiApiKey: "",
        deepseekApiKey: ""
      }));
    } catch (keyError) {
      setError(keyError.message);
    } finally {
      setIsSavingKeys(false);
    }
  }

  async function redrawImage(imageId) {
    if (!job?.id) return;
    setRedrawingId(imageId);
    setError("");

    try {
      const response = await fetch(`/api/jobs/${job.id}/images/${imageId}/redraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "重新制图失败");
      const jobResponse = await fetch(`/api/jobs/${job.id}`);
      const jobPayload = await jobResponse.json();
      if (jobResponse.ok) setJob(jobPayload.job);
    } catch (redrawError) {
      setError(redrawError.message);
    } finally {
      setRedrawingId("");
    }
  }

  return (
    <main className="shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">PPT-Translate</p>
            <h1>PPT / PDF 翻译工作台</h1>
          </div>
          <button className="iconButton" type="button" onClick={refreshJobs} aria-label="刷新任务">
            <RefreshCcw size={18} />
          </button>
        </div>

        <div className="layout">
          <aside className="panel controlPanel">
            <div
              className={`dropzone ${file ? "hasFile" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
              }}
            >
              <UploadCloud size={28} />
              <span>{file ? file.name : "选择 PPTX / PDF"}</span>
              <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "点击上传"}</small>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>

            <div className="field">
              <label>
                <Languages size={16} />
                语种
              </label>
              <div className="segmented">
                {directions.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={direction.label === item.label ? "active" : ""}
                    onClick={() => setDirection(item)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>
                <FileText size={16} />
                OCR
              </label>
              <div className="segmented wrap">
                {ocrModes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={ocrMode === item.value ? "active" : ""}
                    onClick={() => setOcrMode(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="primaryAction" type="button" onClick={upload} disabled={isUploading}>
              {isUploading ? <Loader2 className="spin" size={18} /> : <ArrowRight size={18} />}
              开始翻译
            </button>

            <form className="keyPanel" onSubmit={saveKeys}>
              <div className="sectionTitle">模型 Key</div>
              <div className="providerSelect">
                {["auto", "openai", "deepseek"].map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={keyForm.preferredProvider === provider ? "active" : ""}
                    onClick={() =>
                      setKeyForm((current) => ({ ...current, preferredProvider: provider }))
                    }
                  >
                    {provider}
                  </button>
                ))}
              </div>
              <label className="keyField">
                OpenAI
                <input
                  type="password"
                  placeholder={keyStatus?.openai?.configured ? keyStatus.openai.keyPreview : "sk-..."}
                  value={keyForm.openaiApiKey}
                  onChange={(event) =>
                    setKeyForm((current) => ({ ...current, openaiApiKey: event.target.value }))
                  }
                />
              </label>
              <input
                className="modelInput"
                value={keyForm.openaiModel}
                onChange={(event) =>
                  setKeyForm((current) => ({ ...current, openaiModel: event.target.value }))
                }
              />
              <label className="keyField">
                DeepSeek
                <input
                  type="password"
                  placeholder={
                    keyStatus?.deepseek?.configured ? keyStatus.deepseek.keyPreview : "sk-..."
                  }
                  value={keyForm.deepseekApiKey}
                  onChange={(event) =>
                    setKeyForm((current) => ({ ...current, deepseekApiKey: event.target.value }))
                  }
                />
              </label>
              <input
                className="modelInput"
                value={keyForm.deepseekModel}
                onChange={(event) =>
                  setKeyForm((current) => ({ ...current, deepseekModel: event.target.value }))
                }
              />
              <button className="secondaryAction" type="submit" disabled={isSavingKeys}>
                {isSavingKeys ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                保存 Key
              </button>
            </form>

            {error && (
              <p className="notice error">
                <AlertCircle size={16} />
                {error}
              </p>
            )}

            <div className="history">
              <div className="sectionTitle">任务</div>
              {jobs.length === 0 ? (
                <p className="muted">暂无任务</p>
              ) : (
                jobs.map((item) => (
                  <button
                    className={`jobItem ${job?.id === item.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => loadJob(item.id)}
                  >
                    <span>{item.filename}</span>
                    <small>{statusLabel(item.status)}</small>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="panel resultPanel">
            <div className="resultHeader">
              <div>
                <div className="sectionTitle">译文</div>
                <p className="muted">
                  {job ? `${statusLabel(job.status)} · ${job.filename}` : "等待上传"}
                  {formulaSummary
                    ? ` · 公式${formulaSummary.ok ? "一致" : "有差异"} ${formulaSummary.totalFormulas - formulaSummary.missingFormulas}/${formulaSummary.totalFormulas}`
                    : ""}
                </p>
              </div>
              <div className="exportButtons">
                <a className={!canExport ? "disabled" : ""} href={exportUrl("markdown")}>
                  <Download size={16} />
                  MD
                </a>
                <a className={!canExport ? "disabled" : ""} href={exportUrl("json")}>
                  <Download size={16} />
                  JSON
                </a>
                <a className={!canExport ? "disabled" : ""} href={exportUrl("docx")}>
                  <Download size={16} />
                  DOCX
                </a>
              </div>
            </div>

            {job?.status === "processing" || job?.status === "queued" ? (
              <div className="emptyState">
                <Loader2 className="spin" size={28} />
                <span>{job.message || "正在处理"}</span>
              </div>
            ) : job?.status === "failed" ? (
              <div className="emptyState fail">
                <AlertCircle size={28} />
                <span>{job.error || "任务失败"}</span>
              </div>
            ) : segments.length > 0 ? (
              <div className="segments">
                {segments.map((segment) => (
                  <article className="segment" key={segment.id}>
                    <header>
                      <span>{segment.location}</span>
                      {segment.provider && (
                        <small>
                          <CheckCircle2 size={14} />
                          {segment.provider}
                        </small>
                      )}
                    </header>
                    <div className="textGrid">
                      <p>{segment.sourceText}</p>
                      <p>{segment.translatedText}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <FileText size={28} />
                <span>上传后显示译文</span>
              </div>
            )}
          </section>
        </div>

        {imageItems.length > 0 && (
          <section className="panel imagePanel">
            <div className="sectionTitle">图片 OCR</div>
            <div className="imageGrid">
              {imageItems.map((item) => (
                <article className="imageItem" key={item.id}>
                  <div>
                    <span>{item.location}</span>
                    <small>{item.ocrProvider || "未识别"}</small>
                  </div>
                  <p>{item.ocrText || "无 OCR 文本"}</p>
                  {item.translatedOcrText && <p className="translatedOcr">{item.translatedOcrText}</p>}
                  <div className="imageActions">
                    <button
                      type="button"
                      onClick={() => redrawImage(item.id)}
                      disabled={redrawingId === item.id}
                    >
                      {redrawingId === item.id ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                      重新制图
                    </button>
                    {item.redrawnSvgPath && (
                      <a href={item.redrawnSvgPath}>
                        <Download size={15} />
                        SVG
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
