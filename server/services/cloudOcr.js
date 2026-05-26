import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { getAwsTextractConfig, getAzureOcrConfig } from "./runtimeConfig.js";

export function hasAzureOcrCredentials() {
  const config = getAzureOcrConfig();
  return Boolean(config.endpoint && config.apiKey);
}

export function hasAwsTextractCredentials() {
  const config = getAwsTextractConfig();
  return Boolean(config.accessKeyId && config.secretAccessKey && config.region);
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
