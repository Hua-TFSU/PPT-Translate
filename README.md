# PPT-Translate

PPT-Translate is an initial PPTX/PDF translation platform. It accepts presentation or PDF uploads, extracts slide/page text, runs OCR on image-heavy content when configured, translates between Chinese and English, and exports translated results through JSON, Markdown, DOCX, or PDF endpoints.

## Features

- PPTX and PDF upload API.
- Language direction selection: Chinese to English, English to Chinese, or custom source/target pairs.
- PPTX text extraction from slide XML.
- PPTX image asset extraction with optional local OCR through `tesseract.js`.
- PPTX image previews in the OCR panel through `/api/jobs/:jobId/images/:imageId/original`.
- PDF text-layer extraction through `pdfjs-dist`.
- OCR provider integration path for Mathpix, Azure AI Document Intelligence, AWS Textract, and local Tesseract.
- Login and registration screen for the web workspace, with browser-side persistence of each user's runtime keys and glossary.
- Translation provider chain: OpenAI, DeepSeek, Doubao, DeepL, then a safe unconfigured fallback.
- Formula guard for math-heavy PDFs: formula-like snippets are replaced with placeholders before translation and restored exactly afterward, with a consistency summary in exports.
- Runtime key API for OpenAI, DeepSeek, Doubao, Mathpix, Azure AI, and AWS Textract credentials.
- Glossary API and UI. Saved terms are sent to the model prompt and enforced during translation.
- Export API: JSON, Markdown, DOCX, PDF.
- Redraw API for OCR-recognized PPT images, producing an editable SVG replacement.
- Render deployment blueprint through `render.yaml`.

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`

API: `http://localhost:4000`

## API

### Upload And Translate

```bash
curl -F "file=@sample.pptx" \
  -F "sourceLang=zh" \
  -F "targetLang=en" \
  -F "ocrMode=auto" \
  http://localhost:4000/api/uploads
```

Returns a job id. Poll:

```bash
curl http://localhost:4000/api/jobs/<jobId>
```

### Export Translated Text

```bash
curl -L "http://localhost:4000/api/jobs/<jobId>/export?format=markdown" -o translated.md
curl -L "http://localhost:4000/api/jobs/<jobId>/export?format=json" -o translated.json
curl -L "http://localhost:4000/api/jobs/<jobId>/export?format=docx" -o translated.docx
curl -L "http://localhost:4000/api/jobs/<jobId>/export?format=pdf" -o translated.pdf
```

### Redraw OCR Images

```bash
curl -X POST http://localhost:4000/api/jobs/<jobId>/images/<imageId>/redraw
curl -L http://localhost:4000/api/jobs/<jobId>/images/<imageId>/redraw.svg -o redrawn.svg
```

### Update Model Keys

Keys are stored in server memory and full key values are never returned by the API.

```bash
curl -X PUT http://localhost:4000/api/settings/model-keys \
  -H "Content-Type: application/json" \
  -d '{
    "preferredProvider": "deepseek",
    "openaiApiKey": "sk-...",
    "openaiModel": "gpt-4.1-mini",
    "deepseekApiKey": "sk-...",
    "deepseekModel": "deepseek-v4-flash",
    "doubaoApiKey": "volcengine-ark-key",
    "doubaoModel": "doubao-seed-1-6-251015",
    "mathpixAppId": "app_id",
    "mathpixAppKey": "app_key",
    "azureEndpoint": "https://<resource>.cognitiveservices.azure.com",
    "azureApiKey": "...",
    "azureModel": "prebuilt-read",
    "awsAccessKeyId": "...",
    "awsSecretAccessKey": "...",
    "awsRegion": "us-east-1"
  }'
```

### Update Glossary

```bash
curl -X PUT http://localhost:4000/api/settings/glossary \
  -H "Content-Type: application/json" \
  -d '{
    "terms": [
      { "source": "smart grid", "target": "智能电网", "note": "energy domain" }
    ]
  }'
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables OpenAI translation. |
| `OPENAI_MODEL` | OpenAI model name, defaults to `gpt-4.1-mini`. |
| `DEEPSEEK_API_KEY` | Enables DeepSeek translation. |
| `DEEPSEEK_MODEL` | DeepSeek model name, defaults to `deepseek-v4-flash`. |
| `DOUBAO_API_KEY` | Enables Doubao through Volcengine Ark. |
| `DOUBAO_MODEL` | Doubao model or Ark endpoint id, defaults to `doubao-seed-1-6-251015`. |
| `DOUBAO_API_URL` | Doubao OpenAI-compatible chat completions endpoint. |
| `PREFERRED_TRANSLATION_PROVIDER` | `auto`, `openai`, `deepseek`, or `doubao`. |
| `DEEPL_API_KEY` | Enables DeepL translation if OpenAI is not configured. |
| `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` | Enables dedicated Mathpix OCR for scanned PDFs and formulas. |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` / `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Enables Azure AI Document Intelligence OCR. |
| `AZURE_DOCUMENT_INTELLIGENCE_MODEL` | Azure model, defaults to `prebuilt-read`. |
| `AWS_TEXTRACT_ACCESS_KEY_ID` / `AWS_TEXTRACT_SECRET_ACCESS_KEY` | Enables AWS Textract OCR. |
| `AWS_TEXTRACT_REGION` | AWS region, defaults to `us-east-1`. |
| `ENABLE_LOCAL_OCR` | Enables slower local OCR for extracted PPT image assets. |
| `TESSERACT_LANG` | OCR language pack, defaults to `eng+chi_sim`. |

## OCR Provider Notes

- Mathpix is the best fit when formula-to-LaTeX or math-heavy PDF restoration matters most.
- Azure AI Document Intelligence Read is a strong general OCR option for PDFs, scans, and mixed document layouts.
- AWS Textract is strong for document text extraction, tables, forms, and enterprise AWS deployments.
- Baidu OCR and Alibaba Cloud OCR are good China-region alternatives. Baidu has mature high-accuracy OCR SKUs; Alibaba has document OCR and unified recognition APIs. They are not wired into this MVP yet because their signing and billing flows differ from the current provider set.

## Deploy To Render

[Deploy to Render](https://render.com/deploy?repo=https://github.com/Hua-TFSU/PPT-Translate)

1. Push this repository to GitHub.
2. In Render, create a Blueprint from the repository.
3. Add the secret environment variables for OpenAI/DeepSeek/Doubao/DeepL/Mathpix when you want server-level defaults.
4. Deploy.

The included `render.yaml` already defines the Node web service build and start commands.
