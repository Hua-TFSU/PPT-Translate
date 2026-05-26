import { applyFormulaGuard, prepareSegmentsForTranslation } from "./formulaGuard.js";
import { getProviderConfig } from "./runtimeConfig.js";

const languageNames = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish"
};

const translationSystemPrompt =
  "You are a professional academic and presentation translator. Translate all natural-language prose completely into the target language. If the target language is Chinese, use fluent Simplified Chinese. Apply the provided glossary exactly: when a source term appears, use its target term consistently. Preserve every [[FORMULA_N]] placeholder exactly as given; do not translate, delete, reorder, or edit those placeholders. Preserve equations, citations, units, numbers, proper names, institution names, model names, and technical acronyms such as AI, PV, SOC, GA, MbA. Do not leave full English sentences or ordinary English clauses untranslated unless they are proper names, acronyms, formulas, references, or units. Repair PDF line breaks and hyphenation when translating. Return only valid JSON.";

export async function translateSegments(segments, sourceLang, targetLang) {
  const cleanSegments = prepareSegmentsForTranslation(
    segments.filter((segment) => segment.sourceText?.trim())
  );
  if (cleanSegments.length === 0) return [];
  const providerConfig = getProviderConfig();

  if (providerConfig.preferredProvider === "openai" && providerConfig.openai.apiKey) {
    return translateWithOpenAI(cleanSegments, sourceLang, targetLang, {
      ...providerConfig.openai,
      glossary: providerConfig.glossary
    });
  }

  if (providerConfig.preferredProvider === "deepseek" && providerConfig.deepseek.apiKey) {
    return translateWithDeepSeek(cleanSegments, sourceLang, targetLang, {
      ...providerConfig.deepseek,
      glossary: providerConfig.glossary
    });
  }

  if (providerConfig.openai.apiKey) {
    return translateWithOpenAI(cleanSegments, sourceLang, targetLang, {
      ...providerConfig.openai,
      glossary: providerConfig.glossary
    });
  }

  if (providerConfig.deepseek.apiKey) {
    return translateWithDeepSeek(cleanSegments, sourceLang, targetLang, {
      ...providerConfig.deepseek,
      glossary: providerConfig.glossary
    });
  }

  if (process.env.DEEPL_API_KEY) {
    return translateWithDeepL(cleanSegments, sourceLang, targetLang);
  }

  return cleanSegments.map((segment) => ({
    ...applyFormulaGuard({ ...segment, provider: "unconfigured" }, segment.sourceText)
  }));
}

async function translateWithOpenAI(segments, sourceLang, targetLang, config) {
  const model = config.model;
  const translated = [];

  for (const batch of chunk(segments, 12)) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: translationSystemPrompt
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceLanguage: languageNames[sourceLang] || sourceLang,
              targetLanguage: languageNames[targetLang] || targetLang,
              glossary: config.glossary || [],
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

async function translateWithDeepSeek(segments, sourceLang, targetLang, config) {
  const translated = [];

  for (const batch of chunk(segments, 12)) {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: translationSystemPrompt
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceLanguage: languageNames[sourceLang] || sourceLang,
              targetLanguage: languageNames[targetLang] || targetLang,
              glossary: config.glossary || [],
              outputSchema: {
                translations: [{ id: "string", translatedText: "string" }]
              },
              items: batch.map(({ id, sourceText, location, kind }) => ({
                id,
                location,
                kind,
                text: sourceText
              }))
            })
          }
        ],
        response_format: { type: "json_object" },
        stream: false
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`DeepSeek translation failed: ${response.status} ${detail}`);
    }

    const payload = await response.json();
    const outputText = payload.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(outputText);
    const byId = new Map((parsed.translations || []).map((item) => [item.id, item.translatedText]));

    translated.push(
      ...batch.map((segment) => ({
        ...applyFormulaGuard(
          { ...segment, provider: `deepseek:${config.model}` },
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

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return a JSON object");
    return JSON.parse(match[0]);
  }
}
