const MATHPIX_BASE_URL = "https://api.mathpix.com/v3";

export function hasMathpixCredentials() {
  return Boolean(process.env.MATHPIX_APP_ID && process.env.MATHPIX_APP_KEY);
}

function mathpixHeaders(extra = {}) {
  return {
    app_id: process.env.MATHPIX_APP_ID,
    app_key: process.env.MATHPIX_APP_KEY,
    ...extra
  };
}

export async function recognizeImageWithMathpix(buffer, mimeType) {
  if (!hasMathpixCredentials()) {
    throw new Error("Mathpix credentials are not configured");
  }

  const src = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const response = await fetch(`${MATHPIX_BASE_URL}/text`, {
    method: "POST",
    headers: mathpixHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      src,
      formats: ["text", "data"],
      data_options: {
        include_asciimath: true,
        include_latex: true
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Mathpix image OCR failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return payload.text || "";
}

export async function convertPdfWithMathpix(buffer, filename) {
  if (!hasMathpixCredentials()) {
    throw new Error("Mathpix credentials are not configured");
  }

  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: "application/pdf" }), filename);
  formData.append(
    "options_json",
    JSON.stringify({
      conversion_formats: { md: true },
      math_inline_delimiters: ["$", "$"],
      rm_spaces: true
    })
  );

  const uploadResponse = await fetch(`${MATHPIX_BASE_URL}/pdf`, {
    method: "POST",
    headers: mathpixHeaders(),
    body: formData
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text();
    throw new Error(`Mathpix PDF upload failed: ${uploadResponse.status} ${detail}`);
  }

  const uploadPayload = await uploadResponse.json();
  const pdfId = uploadPayload.pdf_id;
  if (!pdfId) throw new Error("Mathpix PDF upload did not return a pdf_id");

  const maxPolls = Number(process.env.MATHPIX_MAX_POLLS || 36);
  const pollDelayMs = Number(process.env.MATHPIX_POLL_DELAY_MS || 3000);

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    const statusResponse = await fetch(`${MATHPIX_BASE_URL}/pdf/${pdfId}`, {
      headers: mathpixHeaders()
    });

    if (!statusResponse.ok) {
      const detail = await statusResponse.text();
      throw new Error(`Mathpix PDF status failed: ${statusResponse.status} ${detail}`);
    }

    const statusPayload = await statusResponse.json();
    if (statusPayload.status === "completed") {
      const markdownResponse = await fetch(`${MATHPIX_BASE_URL}/pdf/${pdfId}.md`, {
        headers: mathpixHeaders()
      });
      if (!markdownResponse.ok) {
        const detail = await markdownResponse.text();
        throw new Error(`Mathpix Markdown download failed: ${markdownResponse.status} ${detail}`);
      }
      return markdownResponse.text();
    }

    if (statusPayload.status === "error") {
      throw new Error(statusPayload.error || "Mathpix PDF conversion failed");
    }
  }

  throw new Error("Mathpix PDF conversion timed out");
}
