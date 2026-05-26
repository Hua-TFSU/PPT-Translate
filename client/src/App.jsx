import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  Plus,
  RefreshCcw,
  Trash2,
  UploadCloud
} from "lucide-react";

const directions = [
  { label: "中译英", source: "zh", target: "en" },
  { label: "英译中", source: "en", target: "zh" }
];

const languageLabels = {
  zh: "中文",
  en: "English"
};

const ocrModes = [
  { label: "自动", value: "auto" },
  { label: "Mathpix", value: "mathpix" },
  { label: "Azure AI", value: "azure" },
  { label: "AWS Textract", value: "aws" },
  { label: "本地 OCR", value: "local" },
  { label: "仅文本", value: "text" }
];

const emptyKeyForm = {
  preferredProvider: "auto",
  openaiApiKey: "",
  openaiModel: "gpt-4.1-mini",
  deepseekApiKey: "",
  deepseekModel: "deepseek-v4-flash",
  doubaoApiKey: "",
  doubaoModel: "doubao-seed-1-6-251015",
  mathpixAppId: "",
  mathpixAppKey: "",
  azureEndpoint: "",
  azureApiKey: "",
  azureModel: "prebuilt-read",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsRegion: "us-east-1"
};

const emptyTerm = { source: "", target: "", note: "" };
const accountsKey = "pptTranslate:accounts";
const translationProviderOptions = ["auto", "openai", "deepseek", "doubao"];
const keyProviderOptions = [
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "doubao", label: "字节豆包" },
  { value: "mathpix", label: "Mathpix" },
  { value: "azure", label: "Azure AI" },
  { value: "aws", label: "AWS Textract" }
];

function statusLabel(status) {
  return {
    queued: "排队中",
    processing: "处理中",
    completed: "已完成",
    failed: "失败"
  }[status] || status;
}

function storageKey(user, name) {
  return `pptTranslate:${user}:${name}`;
}

function loadJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [currentUser, setCurrentUser] = useState(() => window.localStorage.getItem("pptTranslate:user") || "");
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "", confirmPassword: "" });
  const [file, setFile] = useState(null);
  const [direction, setDirection] = useState(directions[0]);
  const [ocrMode, setOcrMode] = useState("auto");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [redrawingId, setRedrawingId] = useState("");
  const [jobs, setJobs] = useState([]);
  const [appInfo, setAppInfo] = useState(null);
  const [keyStatus, setKeyStatus] = useState(null);
  const [keyForm, setKeyForm] = useState(emptyKeyForm);
  const [activeKeyProvider, setActiveKeyProvider] = useState("openai");
  const [isSavingKeys, setIsSavingKeys] = useState(false);
  const [glossaryTerms, setGlossaryTerms] = useState([emptyTerm]);
  const [isSavingGlossary, setIsSavingGlossary] = useState(false);
  const fileInputRef = useRef(null);

  const canExport = job?.status === "completed";
  const segments = useMemo(() => job?.result?.segments || [], [job]);
  const imageItems = useMemo(() => job?.result?.images || [], [job]);
  const formulaSummary = job?.result?.formulaSummary;
  const warnings = job?.result?.warnings || [];
  const isUntranslated = warnings.some((warning) => warning.includes("not a translated result"));

  useEffect(() => {
    if (!currentUser) return;
    refreshHealth().catch(() => undefined);
    refreshJobs().catch(() => undefined);
    refreshKeyStatus().catch(() => undefined);
    hydrateUserSettings(currentUser).catch(() => undefined);
  }, [currentUser]);

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

  async function refreshHealth() {
    const response = await fetch("/api/health");
    if (response.ok) setAppInfo(await response.json());
  }

  async function refreshJobs() {
    const response = await fetch("/api/jobs");
    if (response.ok) {
      const payload = await response.json();
      setJobs(payload.jobs || []);
    }
  }

  async function refreshKeyStatus() {
    const response = await fetch("/api/settings/model-keys");
    if (response.ok) {
      const payload = await response.json();
      setKeyStatus(payload);
      setKeyForm((current) => ({
        ...current,
        preferredProvider: payload.preferredProvider || "auto",
        openaiModel: payload.openai?.model || current.openaiModel,
        deepseekModel: payload.deepseek?.model || current.deepseekModel,
        doubaoModel: payload.doubao?.model || current.doubaoModel,
        azureEndpoint: payload.azureOcr?.endpoint || current.azureEndpoint,
        azureModel: payload.azureOcr?.model || current.azureModel,
        awsRegion: payload.awsTextract?.region || current.awsRegion
      }));
    }
  }

  async function hydrateUserSettings(user) {
    const savedKeys = loadJson(storageKey(user, "keys"), null);
    const savedGlossary = loadJson(storageKey(user, "glossary"), null);

    if (savedKeys) {
      setKeyForm((current) => ({
        ...current,
        ...savedKeys,
        openaiApiKey: "",
        deepseekApiKey: "",
        doubaoApiKey: "",
        mathpixAppKey: "",
        azureApiKey: "",
        awsSecretAccessKey: ""
      }));
      await fetch("/api/settings/model-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savedKeys)
      });
      await refreshKeyStatus();
    }

    if (savedGlossary?.terms?.length) {
      setGlossaryTerms(savedGlossary.terms);
      await fetch("/api/settings/glossary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savedGlossary)
      });
    }
  }

  function login(event) {
    event.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password;
    if (!username) {
      setError("请输入用户名");
      return;
    }
    const accounts = loadJson(accountsKey, {});
    if (!accounts[username]) {
      setError("用户不存在，请先注册");
      setAuthMode("register");
      return;
    }
    if (accounts[username].password !== password) {
      setError("密码不正确");
      return;
    }
    window.localStorage.setItem("pptTranslate:user", username);
    setCurrentUser(username);
    setError("");
  }

  function register(event) {
    event.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password;
    if (!username) {
      setError("请输入用户名");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== loginForm.confirmPassword) {
      setError("两次密码不一致");
      return;
    }

    const accounts = loadJson(accountsKey, {});
    if (accounts[username]) {
      setError("用户已存在，请直接登录");
      setAuthMode("login");
      return;
    }

    const nextAccounts = {
      ...accounts,
      [username]: {
        password,
        createdAt: new Date().toISOString()
      }
    };
    window.localStorage.setItem(accountsKey, JSON.stringify(nextAccounts));
    window.localStorage.setItem("pptTranslate:user", username);
    setCurrentUser(username);
    setError("");
  }

  function logout() {
    window.localStorage.removeItem("pptTranslate:user");
    setCurrentUser("");
    setJob(null);
    setJobs([]);
    setFile(null);
    setError("");
  }

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

    const previous = loadJson(storageKey(currentUser, "keys"), emptyKeyForm);
    const nextKeys = {
      ...previous,
      preferredProvider: keyForm.preferredProvider,
      openaiModel: keyForm.openaiModel,
      deepseekModel: keyForm.deepseekModel,
      doubaoModel: keyForm.doubaoModel,
      ...(keyForm.openaiApiKey.trim() ? { openaiApiKey: keyForm.openaiApiKey.trim() } : {}),
      ...(keyForm.deepseekApiKey.trim() ? { deepseekApiKey: keyForm.deepseekApiKey.trim() } : {}),
      ...(keyForm.doubaoApiKey.trim() ? { doubaoApiKey: keyForm.doubaoApiKey.trim() } : {}),
      ...(keyForm.mathpixAppId.trim() ? { mathpixAppId: keyForm.mathpixAppId.trim() } : {}),
      ...(keyForm.mathpixAppKey.trim() ? { mathpixAppKey: keyForm.mathpixAppKey.trim() } : {}),
      ...(keyForm.azureEndpoint.trim() ? { azureEndpoint: keyForm.azureEndpoint.trim() } : {}),
      ...(keyForm.azureApiKey.trim() ? { azureApiKey: keyForm.azureApiKey.trim() } : {}),
      ...(keyForm.azureModel.trim() ? { azureModel: keyForm.azureModel.trim() } : {}),
      ...(keyForm.awsAccessKeyId.trim() ? { awsAccessKeyId: keyForm.awsAccessKeyId.trim() } : {}),
      ...(keyForm.awsSecretAccessKey.trim() ? { awsSecretAccessKey: keyForm.awsSecretAccessKey.trim() } : {}),
      ...(keyForm.awsRegion.trim() ? { awsRegion: keyForm.awsRegion.trim() } : {})
    };

    try {
      const response = await fetch("/api/settings/model-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextKeys)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存 Key 失败");
      window.localStorage.setItem(storageKey(currentUser, "keys"), JSON.stringify(nextKeys));
      setKeyStatus(payload);
      setKeyForm((current) => ({
        ...current,
        openaiApiKey: "",
        deepseekApiKey: "",
        doubaoApiKey: "",
        mathpixAppKey: "",
        azureApiKey: "",
        awsSecretAccessKey: ""
      }));
    } catch (keyError) {
      setError(keyError.message);
    } finally {
      setIsSavingKeys(false);
    }
  }

  async function saveGlossary(event) {
    event.preventDefault();
    setIsSavingGlossary(true);
    setError("");
    const terms = glossaryTerms
      .map((term) => ({
        source: term.source.trim(),
        target: term.target.trim(),
        note: term.note.trim()
      }))
      .filter((term) => term.source && term.target);

    try {
      const response = await fetch("/api/settings/glossary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存术语库失败");
      const next = payload.terms.length ? payload.terms : [emptyTerm];
      setGlossaryTerms(next);
      window.localStorage.setItem(storageKey(currentUser, "glossary"), JSON.stringify({ terms: next }));
    } catch (glossaryError) {
      setError(glossaryError.message);
    } finally {
      setIsSavingGlossary(false);
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

  function updateTerm(index, patch) {
    setGlossaryTerms((current) =>
      current.map((term, termIndex) => (termIndex === index ? { ...term, ...patch } : term))
    );
  }

  function removeTerm(index) {
    setGlossaryTerms((current) => {
      const next = current.filter((_, termIndex) => termIndex !== index);
      return next.length ? next : [emptyTerm];
    });
  }

  function renderKeyFields() {
    if (activeKeyProvider === "openai") {
      return (
        <>
          <label className="keyField">
            OpenAI API Key
            <input
              type="password"
              placeholder={keyStatus?.openai?.configured ? keyStatus.openai.keyPreview : "sk-..."}
              value={keyForm.openaiApiKey}
              onChange={(event) => setKeyForm((current) => ({ ...current, openaiApiKey: event.target.value }))}
            />
          </label>
          <label className="keyField">
            OpenAI 模型
            <input
              value={keyForm.openaiModel}
              onChange={(event) => setKeyForm((current) => ({ ...current, openaiModel: event.target.value }))}
            />
          </label>
        </>
      );
    }

    if (activeKeyProvider === "deepseek") {
      return (
        <>
          <label className="keyField">
            DeepSeek API Key
            <input
              type="password"
              placeholder={keyStatus?.deepseek?.configured ? keyStatus.deepseek.keyPreview : "sk-..."}
              value={keyForm.deepseekApiKey}
              onChange={(event) => setKeyForm((current) => ({ ...current, deepseekApiKey: event.target.value }))}
            />
          </label>
          <label className="keyField">
            DeepSeek 模型
            <input
              value={keyForm.deepseekModel}
              onChange={(event) => setKeyForm((current) => ({ ...current, deepseekModel: event.target.value }))}
            />
          </label>
        </>
      );
    }

    if (activeKeyProvider === "doubao") {
      return (
        <>
          <label className="keyField">
            字节豆包 API Key
            <input
              type="password"
              placeholder={keyStatus?.doubao?.configured ? keyStatus.doubao.keyPreview : "Volcengine Ark API Key"}
              value={keyForm.doubaoApiKey}
              onChange={(event) => setKeyForm((current) => ({ ...current, doubaoApiKey: event.target.value }))}
            />
          </label>
          <label className="keyField">
            方舟模型或接入点 ID
            <input
              value={keyForm.doubaoModel}
              onChange={(event) => setKeyForm((current) => ({ ...current, doubaoModel: event.target.value }))}
            />
          </label>
          <a className="secondaryLink" href="https://console.volcengine.com/ark" target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            打开火山方舟控制台
          </a>
        </>
      );
    }

    if (activeKeyProvider === "mathpix") {
      return (
        <>
          <label className="keyField">
            Mathpix App ID
            <input
              placeholder={keyStatus?.mathpix?.configured ? keyStatus.mathpix.appIdPreview : "app_id"}
              value={keyForm.mathpixAppId}
              onChange={(event) => setKeyForm((current) => ({ ...current, mathpixAppId: event.target.value }))}
            />
          </label>
          <label className="keyField">
            Mathpix App Key
            <input
              type="password"
              placeholder={keyStatus?.mathpix?.configured ? keyStatus.mathpix.appKeyPreview : "app_key"}
              value={keyForm.mathpixAppKey}
              onChange={(event) => setKeyForm((current) => ({ ...current, mathpixAppKey: event.target.value }))}
            />
          </label>
          <a className="secondaryLink" href="https://console.mathpix.com/ocr-api" target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            打开 Mathpix OCR API
          </a>
        </>
      );
    }

    if (activeKeyProvider === "azure") {
      return (
        <>
          <label className="keyField">
            Azure Document Intelligence Endpoint
            <input
              placeholder="https://<resource>.cognitiveservices.azure.com"
              value={keyForm.azureEndpoint}
              onChange={(event) => setKeyForm((current) => ({ ...current, azureEndpoint: event.target.value }))}
            />
          </label>
          <label className="keyField">
            Azure API Key
            <input
              type="password"
              placeholder={keyStatus?.azureOcr?.configured ? keyStatus.azureOcr.keyPreview : "Azure key"}
              value={keyForm.azureApiKey}
              onChange={(event) => setKeyForm((current) => ({ ...current, azureApiKey: event.target.value }))}
            />
          </label>
          <label className="keyField">
            Azure 模型
            <input
              value={keyForm.azureModel}
              onChange={(event) => setKeyForm((current) => ({ ...current, azureModel: event.target.value }))}
            />
          </label>
          <a className="secondaryLink" href="https://portal.azure.com/" target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            打开 Azure 门户
          </a>
        </>
      );
    }

    return (
      <>
        <label className="keyField">
          AWS Access Key ID
          <input
            placeholder={keyStatus?.awsTextract?.configured ? keyStatus.awsTextract.accessKeyPreview : "AKIA..."}
            value={keyForm.awsAccessKeyId}
            onChange={(event) => setKeyForm((current) => ({ ...current, awsAccessKeyId: event.target.value }))}
          />
        </label>
        <label className="keyField">
          AWS Secret Access Key
          <input
            type="password"
            placeholder={keyStatus?.awsTextract?.configured ? keyStatus.awsTextract.secretKeyPreview : "secret"}
            value={keyForm.awsSecretAccessKey}
            onChange={(event) => setKeyForm((current) => ({ ...current, awsSecretAccessKey: event.target.value }))}
          />
        </label>
        <label className="keyField">
          AWS Region
          <input
            value={keyForm.awsRegion}
            onChange={(event) => setKeyForm((current) => ({ ...current, awsRegion: event.target.value }))}
          />
        </label>
        <a className="secondaryLink" href="https://console.aws.amazon.com/textract/" target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          打开 AWS Textract
        </a>
      </>
    );
  }

  if (!currentUser) {
    return (
      <main className="loginShell">
        <section className="loginPanel">
          <p className="eyebrow">PPT-Translate</p>
          <h1>智能PPT翻译系统</h1>
          <div className="authSwitch">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setError("");
              }}
            >
              登录
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setError("");
              }}
            >
              注册
            </button>
          </div>
          <form onSubmit={authMode === "register" ? register : login} className="loginForm">
            <label>
              用户名
              <input
                value={loginForm.username}
                onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="请输入用户名"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={authMode === "register" ? "至少 6 位" : "请输入密码"}
              />
            </label>
            {authMode === "register" && (
              <label>
                确认密码
                <input
                  type="password"
                  value={loginForm.confirmPassword}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, confirmPassword: event.target.value }))
                  }
                  placeholder="再次输入密码"
                />
              </label>
            )}
            <button className="primaryAction" type="submit">
              <ArrowRight size={18} />
              {authMode === "register" ? "注册并登录" : "登录"}
            </button>
            {error && (
              <p className="notice error">
                <AlertCircle size={16} />
                {error}
              </p>
            )}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">PPT-Translate</p>
            <h1>PPT / PDF 翻译工作台</h1>
            {appInfo?.version && <p className="versionText">v{appInfo.version}</p>}
          </div>
          <div className="topbarActions">
            <span>{currentUser}</span>
            <button className="iconButton" type="button" onClick={refreshJobs} aria-label="刷新任务">
              <RefreshCcw size={18} />
            </button>
            <button className="iconButton" type="button" onClick={logout} aria-label="退出登录">
              <LogOut size={18} />
            </button>
          </div>
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
              <div className="sectionTitle">
                <KeyRound size={16} />
                API Key
              </div>
              <div className="subSectionTitle">翻译优先</div>
              <div className="providerSelect">
                {translationProviderOptions.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={keyForm.preferredProvider === provider ? "active" : ""}
                    onClick={() => setKeyForm((current) => ({ ...current, preferredProvider: provider }))}
                  >
                    {provider}
                  </button>
                ))}
              </div>
              <div className="subSectionTitle">API 提供商</div>
              <div className="apiProviderGrid">
                {keyProviderOptions.map((provider) => (
                  <button
                    key={provider.value}
                    type="button"
                    className={activeKeyProvider === provider.value ? "active" : ""}
                    onClick={() => setActiveKeyProvider(provider.value)}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
              {renderKeyFields()}
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
                  {job
                    ? ` · ${languageLabels[job.sourceLang] || job.sourceLang} -> ${languageLabels[job.targetLang] || job.targetLang}`
                    : ""}
                  {formulaSummary
                    ? ` · 公式${formulaSummary.ok ? "一致" : "有差异"} ${
                        formulaSummary.totalFormulas - formulaSummary.missingFormulas
                      }/${formulaSummary.totalFormulas}`
                    : ""}
                </p>
                {isUntranslated && <p className="warningText">未配置模型 Key，当前结果不是译文。</p>}
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
                <a className={!canExport ? "disabled" : ""} href={exportUrl("pdf")}>
                  <Download size={16} />
                  PDF
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

        <section className="panel glossaryPanel">
          <form onSubmit={saveGlossary}>
            <div className="glossaryHeader">
              <div className="sectionTitle">
                <BookOpen size={16} />
                术语库
              </div>
              <button
                className="secondaryAction compact"
                type="button"
                onClick={() => setGlossaryTerms((current) => [...current, emptyTerm])}
              >
                <Plus size={15} />
                添加术语
              </button>
            </div>
            <div className="termGrid">
              {glossaryTerms.map((term, index) => (
                <div className="termRow" key={`${index}-${term.source}`}>
                  <input
                    placeholder="原文术语"
                    value={term.source}
                    onChange={(event) => updateTerm(index, { source: event.target.value })}
                  />
                  <input
                    placeholder="指定译法"
                    value={term.target}
                    onChange={(event) => updateTerm(index, { target: event.target.value })}
                  />
                  <input
                    placeholder="备注"
                    value={term.note}
                    onChange={(event) => updateTerm(index, { note: event.target.value })}
                  />
                  <button type="button" className="iconButton" onClick={() => removeTerm(index)} aria-label="删除术语">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button className="secondaryAction glossarySave" type="submit" disabled={isSavingGlossary}>
              {isSavingGlossary ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
              保存术语库
            </button>
          </form>
        </section>

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
                  {item.originalImageUrl && (
                    <img className="ocrPreview" src={item.originalImageUrl} alt={item.location} />
                  )}
                  <p>{item.ocrText || "无 OCR 文本"}</p>
                  {item.translatedOcrText && <p className="translatedOcr">{item.translatedOcrText}</p>}
                  <div className="imageActions">
                    <button type="button" onClick={() => redrawImage(item.id)} disabled={redrawingId === item.id}>
                      {redrawingId === item.id ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <RefreshCcw size={15} />
                      )}
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
