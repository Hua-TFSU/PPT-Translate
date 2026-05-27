import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { getAwsTextractConfig, getAzureOcrConfig, getBaiduOcrConfig } from "./runtimeConfig.js";

let baiduTokenCache = null;

export function hasAzureOcrCredentials() {
  const config = getAzureOcrConfig();
  return Boolean(config.endpoint && config.apiKey);
}

export function hasAwsTextractCredentials() {
  const config = getAwsTextractConfig();
  return Boolean(config.accessKeyId && config.secretAccessKey && config.region);
}

export function hasBaiduOcrCredentials() {
  const config = getBaiduOcrConfig();
  return Boolean(config.apiKey && config.secretKey);
}

export async function recognizeDocumentWithAzure(buffer, mimeType = "application/octet-stream") {
  const config = getAzureOcrConfig();
  if (!hasAzureOcrCredentials()) {
    throw new Error("Azure AI Document Intelligence credentials are not configured");
  }

  const endpoint = config.endpoint.replace(/\/+$/, "");
  const apiVersion = config.apiVersion || "2024-11-30";
  const model = config.model || "prebuilt-read";
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(
    model
  )}:analyze?api-version=${encodeURIComponent(apiVersion)}`;

  const analyzeResponse = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "Ocp-Apim-Subscription-Key": config.apiKey
    },
    body: buffer
  });

  if (!analyzeResponse.ok) {
    const detail = await analyzeResponse.text();
    throw new Error(`Azure OCR analyze failed: ${analyzeResponse.status} ${detail}`);
  }

  const operationLocation = analyzeResponse.headers.get("operation-location");
  if (!operationLocation) {
    const payload = await analyzeResponse.json().catch(() => ({}));
    return azureResultToText(payload);
  }

  const maxPolls = Number(process.env.AZURE_OCR_MAX_POLLS || 24);
  const pollDelayMs = Number(process.env.AZURE_OCR_POLL_DELAY_MS || 1500);

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    const statusResponse = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": config.apiKey
      }
    });

    if (!statusResponse.ok) {
      const detail = await statusResponse.text();
      throw new Error(`Azure OCR status failed: ${statusResponse.status} ${detail}`);
    }

    const payload = await statusResponse.json();
    if (payload.status === "succeeded") return azureResultToText(payload);
    if (payload.status === "failed") throw new Error(payload.error?.message || "Azure OCR failed");
  }

  throw new Error("Azure OCR timed out");
}

export async function recognizeDocumentWithAwsTextract(buffer) {
  const config = getAwsTextractConfig();
  if (!hasAwsTextractCredentials()) {
    throw new Error("AWS Textract credentials are not configured");
  }

  const client = new TextractClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  const result = await client.send(
    new DetectDocumentTextCommand({
      Document: {
        Bytes: buffer
      }
    })
  );

  return awsBlocksToText(result.Blocks || []);
}

export async function recognizeDocumentWithBaidu(buffer, mimeType = "application/octet-stream") {
  const config = getBaiduOcrConfig();
  if (!hasBaiduOcrCredentials()) {
    throw new Error("Baidu OCR credentials are not configured");
  }

  const accessToken = await getBaiduAccessToken(config);
  const endpoint = config.endpoint || "accurate_basic";
  const ocrUrl = new URL(`https://aip.baidubce.com/rest/2.0/ocr/v1/${endpoint}`);
  ocrUrl.searchParams.set("access_token", accessToken);

  const body = new URLSearchParams();
  if (mimeType === "application/pdf") {
    body.set("pdf_file", buffer.toString("base64"));
  } else {
    body.set("image", buffer.toString("base64"));
  }
  body.set("language_type", "CHN_ENG");
  body.set("detect_direction", "true");
  body.set("paragraph", "false");

  const response = await fetch(ocrUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json();
  if (!response.ok || payload.error_code) {
    throw new Error(`Baidu OCR failed: ${payload.error_code || response.status} ${payload.error_msg || ""}`.trim());
  }

  return baiduWordsToText(payload.words_result || []);
}

function azureResultToText(payload) {
  const result = payload.analyzeResult || payload;
  if (result.content?.trim()) return result.content.trim();

  return (result.pages || [])
    .flatMap((page) => page.lines || [])
    .map((line) => line.content)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function awsBlocksToText(blocks) {
  return blocks
    .filter((block) => block.BlockType === "LINE" && block.Text)
    .sort((a, b) => (a.Page || 0) - (b.Page || 0))
    .map((block) => block.Text)
    .join("\n")
    .trim();
}

async function getBaiduAccessToken(config) {
  const cacheKey = `${config.apiKey}:${config.secretKey}`;
  if (baiduTokenCache?.cacheKey === cacheKey && baiduTokenCache.expiresAt > Date.now() + 60_000) {
    return baiduTokenCache.token;
  }

  const tokenUrl = new URL("https://aip.baidubce.com/oauth/2.0/token");
  tokenUrl.searchParams.set("grant_type", "client_credentials");
  tokenUrl.searchParams.set("client_id", config.apiKey);
  tokenUrl.searchParams.set("client_secret", config.secretKey);

  const response = await fetch(tokenUrl, { method: "POST" });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`Baidu token failed: ${payload.error || response.status} ${payload.error_description || ""}`.trim());
  }

  baiduTokenCache = {
    cacheKey,
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 0) * 1000
  };
  return baiduTokenCache.token;
}

function baiduWordsToText(words) {
  return words
    .map((item) => item.words)
    .filter(Boolean)
    .join("\n")
    .trim();
}
