const formulaLineSymbols = /[=≤≥<>+\-*/^_{}()[\]|∑∫√π∞≈≠±×÷→←∈∀αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/;
const digitOrMathLetter =
  /[0-9A-Za-zαβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/;

const inlineFormulaPatterns = [
  /\$\$[\s\S]+?\$\$/g,
  /\$[^$\n]{1,240}\$/g,
  /\\\[[\s\S]+?\\\]/g,
  /\\\([\s\S]+?\\\)/g,
  /\b[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z0-9_,\s+-]{1,40}\s*\)/g,
  /[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ](?:\s*[=_^]\s*[A-Za-z0-9]+)?/g
];

export function protectFormulas(text) {
  const formulas = [];
  let protectedText = String(text || "");

  protectedText = protectFormulaLines(protectedText, formulas);
  protectedText = protectInlineFormulas(protectedText, formulas);

  return {
    protectedText,
    formulas
  };
}

export function restoreFormulas(text, formulas = []) {
  let restored = String(text || "");

  formulas.forEach((formula) => {
    const placeholderPattern = new RegExp(escapeRegExp(formula.placeholder).replace(/\\ /g, "\\s*"), "g");
    restored = restored.replace(placeholderPattern, formula.text);
  });

  return restored;
}

export function checkFormulaConsistency(sourceText, translatedText) {
  const sourceFormulas = extractFormulaSnippets(sourceText);
  const target = String(translatedText || "");
  const missing = sourceFormulas.filter((formula) => !target.includes(formula));

  return {
    ok: missing.length === 0,
    sourceFormulaCount: sourceFormulas.length,
    missingFormulaCount: missing.length,
    missing
  };
}

export function extractFormulaSnippets(text) {
  const formulas = [];
  const source = String(text || "");

  source.split(/\n/).forEach((line) => {
    const trimmed = line.trim();
    if (isFormulaLine(trimmed)) formulas.push(trimmed);
  });

  inlineFormulaPatterns.forEach((pattern) => {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const value = match[0].trim();
      if (value && isUsefulFormula(value)) formulas.push(value);
    }
  });

  return uniqueNonContained(formulas);
}

export function applyFormulaGuard(segment, translatedText) {
  const formulas = segment.formulaProtection?.formulas || [];
  const restoredText = restoreFormulas(translatedText, formulas);
  return {
    ...segment.originalSegment,
    translatedText: restoredText,
    provider: segment.provider,
    formulaCheck: checkFormulaConsistency(segment.originalSegment.sourceText, restoredText)
  };
}

export function prepareSegmentsForTranslation(segments) {
  return segments.map((segment) => {
    const formulaProtection = protectFormulas(segment.sourceText);
    return {
      ...segment,
      originalSegment: segment,
      sourceText: formulaProtection.protectedText,
      formulaProtection
    };
  });
}

function protectFormulaLines(text, formulas) {
  return text
    .split(/\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!isFormulaLine(trimmed)) return line;
      return registerFormula(formulas, trimmed);
    })
    .join("\n");
}

function protectInlineFormulas(text, formulas) {
  let output = text;
  inlineFormulaPatterns.forEach((pattern) => {
    pattern.lastIndex = 0;
    output = output.replace(pattern, (match) => {
      const value = match.trim();
      if (!isUsefulFormula(value)) return match;
      return registerFormula(formulas, value);
    });
  });
  return output;
}

function registerFormula(formulas, text) {
  const existing = formulas.find((formula) => formula.text === text);
  if (existing) return existing.placeholder;
  const placeholder = `[[FORMULA_${formulas.length}]]`;
  formulas.push({ placeholder, text });
  return placeholder;
}

function isFormulaLine(line) {
  if (!line || line.length > 220) return false;
  if (!formulaLineSymbols.test(line) || !digitOrMathLetter.test(line)) return false;
  if (/^Fig\./i.test(line)) return false;
  if (/^[A-Z][a-z]+(?:\s+[a-z]+){5,}/.test(line)) return false;

  const words = line.match(/[A-Za-z]{3,}/g) || [];
  const mathSymbols = line.match(/[=≤≥<>+\-*/^_{}()[\]|∑∫√≈≠±×÷→←∈∀]/g) || [];
  const hasGreek = /[αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/.test(line);
  return hasGreek || mathSymbols.length >= 1 || words.length <= 4;
}

function isUsefulFormula(value) {
  if (!value || value.length > 260) return false;
  if (/^\[[0-9,\s-]+\]$/.test(value)) return false;
  return formulaLineSymbols.test(value) && digitOrMathLetter.test(value);
}

function uniqueNonContained(values) {
  const uniqueValues = Array.from(new Set(values));
  return uniqueValues.filter(
    (value) => !uniqueValues.some((candidate) => candidate !== value && candidate.includes(value))
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
