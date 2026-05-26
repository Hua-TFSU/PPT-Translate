import { applyFormulaGuard, prepareSegmentsForTranslation } from "./formulaGuard.js";

const languageNames = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish"
};

export async function translateSegments(segments, sourceLang, targetLang) {
  const cleanSegments = prepareSegmentsForTranslation(
    segments.filter((segment) => segment.sourceText?.trim())
  );
  if (cleanSegments.length === 0) return [];

  if (process.env.OPENAI_API_KEY) {
    return translateWithOpenAI(cleanSegments, sourceLang, targetLang);
  }

  if (process.env.DEEPL_API_KEY) {
    return translateWithDeepL(cleanSegments, sourceLang, targetLang);
  }

  return cleanSegments.map((segment) => ({
    ...applyFormulaGuard({ ...segment, provider: "unconfigured" }, segment.sourceText)
  }));
}

async function translateWithOpenAI(segments, sourceLang, targetLang) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const translated = [];

  for (const batch of chunk(segments, 12)) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "You are a professional presentation translator. Translate faithfully. Preserve every [[FORMULA_N]] placeholder exactly as given; do not translate, delete, reorder, or edit those placeholders. Preserve markdown, numbers, names, and slide structure. Return only valid JSON."
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceLanguage: languageNames[sourceLang] || sourceLang,
              targetLanguage: languageNames[targetLang] || targetLang,
              items: batch.map(({ id, sourceText, location, kind }) => ({
                id,
                location,
                kind,
                text: sourceText
              }))
            })
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "translation_batch",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                translations: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      translatedText: { type: "string" }
                    },
                    required: ["id", "translatedText"]
                  }
                }
              },
              required: ["translations"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI translation failed: ${response.status} ${detail}`);
    }

    const payload = await response.json();
    const outputText = payload.output_text || collectResponseText(payload);
    const parsed = JSON.parse(outputText);
    const byId = new Map(parsed.translations.map((item) => [item.id, item.translatedText]));

    translated.push(
      ...batch.map((segment) => ({
        ...applyFormulaGuard(
          { ...segment, provider: `openai:${model}` },
          byId.get(segment.id) || segment.sourceText
        )
      }))
    );
  }

  return translated;
}

async function translateWithDeepL(segments, sourceLang, targetLang) {
  const deeplUrl = process.env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate";
  const params = new URLSearchParams();
  segments.forEach((segment) => params.append("text", segment.sourceText));
  params.set("source_lang", deeplLang(sourceLang, "source"));
  params.set("target_lang", deeplLang(targetLang, "target"));

  const response = await fetch(deeplUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepL translation failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return segments.map((segment, index) => ({
    ...applyFormulaGuard(
      { ...segment, provider: "deepl" },
      payload.translations?.[index]?.text || segment.sourceText
    )
  }));
}

function deeplLang(lang, mode) {
  if (lang === "zh") return "ZH";
  if (lang === "en" && mode === "target") return "EN-US";
  if (lang === "en") return "EN";
  return lang.toUpperCase();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function collectResponseText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.text)
    .map((item) => item.text)
    .join("");
}
