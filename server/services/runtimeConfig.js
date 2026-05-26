const runtimeConfig = {
  preferredProvider: process.env.PREFERRED_TRANSLATION_PROVIDER || "auto",
  openai: {
    apiKey: "",
    model: ""
  },
  deepseek: {
    apiKey: "",
    model: ""
  },
  doubao: {
    apiKey: "",
    model: ""
  },
  mathpix: {
    appId: "",
    appKey: ""
  },
  azureOcr: {
    endpoint: "",
    apiKey: "",
    model: ""
  },
  awsTextract: {
    accessKeyId: "",
    secretAccessKey: "",
    region: ""
  },
  glossary: []
};

export function updateModelKeys(input = {}) {
  if (typeof input.preferredProvider === "string") {
    runtimeConfig.preferredProvider = input.preferredProvider;
  }

  if (typeof input.openaiApiKey === "string" && input.openaiApiKey.trim()) {
    runtimeConfig.openai.apiKey = input.openaiApiKey.trim();
  }

  if (typeof input.openaiModel === "string" && input.openaiModel.trim()) {
    runtimeConfig.openai.model = input.openaiModel.trim();
  }

  if (typeof input.deepseekApiKey === "string" && input.deepseekApiKey.trim()) {
    runtimeConfig.deepseek.apiKey = input.deepseekApiKey.trim();
  }

  if (typeof input.deepseekModel === "string" && input.deepseekModel.trim()) {
    runtimeConfig.deepseek.model = input.deepseekModel.trim();
  }

  if (typeof input.doubaoApiKey === "string" && input.doubaoApiKey.trim()) {
    runtimeConfig.doubao.apiKey = input.doubaoApiKey.trim();
  }

  if (typeof input.doubaoModel === "string" && input.doubaoModel.trim()) {
    runtimeConfig.doubao.model = input.doubaoModel.trim();
  }

  if (typeof input.mathpixAppId === "string" && input.mathpixAppId.trim()) {
    runtimeConfig.mathpix.appId = input.mathpixAppId.trim();
  }

  if (typeof input.mathpixAppKey === "string" && input.mathpixAppKey.trim()) {
    runtimeConfig.mathpix.appKey = input.mathpixAppKey.trim();
  }

  if (typeof input.azureEndpoint === "string" && input.azureEndpoint.trim()) {
    runtimeConfig.azureOcr.endpoint = input.azureEndpoint.trim();
  }

  if (typeof input.azureApiKey === "string" && input.azureApiKey.trim()) {
    runtimeConfig.azureOcr.apiKey = input.azureApiKey.trim();
  }

  if (typeof input.azureModel === "string" && input.azureModel.trim()) {
    runtimeConfig.azureOcr.model = input.azureModel.trim();
  }

  if (typeof input.awsAccessKeyId === "string" && input.awsAccessKeyId.trim()) {
    runtimeConfig.awsTextract.accessKeyId = input.awsAccessKeyId.trim();
  }

  if (typeof input.awsSecretAccessKey === "string" && input.awsSecretAccessKey.trim()) {
    runtimeConfig.awsTextract.secretAccessKey = input.awsSecretAccessKey.trim();
  }

  if (typeof input.awsRegion === "string" && input.awsRegion.trim()) {
    runtimeConfig.awsTextract.region = input.awsRegion.trim();
  }

  if (input.clearOpenAI === true) {
    runtimeConfig.openai.apiKey = "";
  }

  if (input.clearDeepSeek === true) {
    runtimeConfig.deepseek.apiKey = "";
  }

  if (input.clearDoubao === true) {
    runtimeConfig.doubao.apiKey = "";
  }

  if (input.clearMathpix === true) {
    runtimeConfig.mathpix.appId = "";
    runtimeConfig.mathpix.appKey = "";
  }

  if (input.clearAzure === true) {
    runtimeConfig.azureOcr.endpoint = "";
    runtimeConfig.azureOcr.apiKey = "";
  }

  if (input.clearAws === true) {
    runtimeConfig.awsTextract.accessKeyId = "";
    runtimeConfig.awsTextract.secretAccessKey = "";
  }

  return getModelKeyStatus();
}

export function updateGlossary(input = {}) {
  const terms = Array.isArray(input.terms) ? input.terms : [];
  runtimeConfig.glossary = terms
    .map((term) => ({
      source: String(term.source || "").trim(),
      target: String(term.target || "").trim(),
      note: String(term.note || "").trim()
    }))
    .filter((term) => term.source && term.target)
    .slice(0, 300);
  return getGlossary();
}

export function getGlossary() {
  return {
    terms: runtimeConfig.glossary
  };
}

export function getProviderConfig() {
  return {
    preferredProvider: runtimeConfig.preferredProvider,
    openai: {
      apiKey: runtimeConfig.openai.apiKey || process.env.OPENAI_API_KEY || "",
      model: runtimeConfig.openai.model || process.env.OPENAI_MODEL || "gpt-4.1-mini"
    },
    deepseek: {
      apiKey: runtimeConfig.deepseek.apiKey || process.env.DEEPSEEK_API_KEY || "",
      model:
        runtimeConfig.deepseek.model ||
        process.env.DEEPSEEK_MODEL ||
        "deepseek-v4-flash",
      apiUrl: process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions"
    },
    doubao: {
      apiKey: runtimeConfig.doubao.apiKey || process.env.DOUBAO_API_KEY || "",
      model:
        runtimeConfig.doubao.model ||
        process.env.DOUBAO_MODEL ||
        "doubao-seed-1-6-251015",
      apiUrl: process.env.DOUBAO_API_URL || "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
    },
    glossary: runtimeConfig.glossary
  };
}

export function getMathpixConfig() {
  return {
    appId: runtimeConfig.mathpix.appId || process.env.MATHPIX_APP_ID || "",
    appKey: runtimeConfig.mathpix.appKey || process.env.MATHPIX_APP_KEY || ""
  };
}

export function getAzureOcrConfig() {
  return {
    endpoint: runtimeConfig.azureOcr.endpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "",
    apiKey: runtimeConfig.azureOcr.apiKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "",
    model: runtimeConfig.azureOcr.model || process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL || "prebuilt-read",
    apiVersion: process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || "2024-11-30"
  };
}

export function getAwsTextractConfig() {
  return {
    accessKeyId: runtimeConfig.awsTextract.accessKeyId || process.env.AWS_TEXTRACT_ACCESS_KEY_ID || "",
    secretAccessKey:
      runtimeConfig.awsTextract.secretAccessKey || process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY || "",
    region: runtimeConfig.awsTextract.region || process.env.AWS_TEXTRACT_REGION || "us-east-1"
  };
}

export function getModelKeyStatus() {
  const providerConfig = getProviderConfig();
  const azureConfig = getAzureOcrConfig();
  const awsConfig = getAwsTextractConfig();
  return {
    preferredProvider: providerConfig.preferredProvider,
    openai: {
      configured: Boolean(providerConfig.openai.apiKey),
      source: runtimeConfig.openai.apiKey ? "runtime" : process.env.OPENAI_API_KEY ? "env" : "none",
      keyPreview: maskKey(providerConfig.openai.apiKey),
      model: providerConfig.openai.model
    },
    deepseek: {
      configured: Boolean(providerConfig.deepseek.apiKey),
      source: runtimeConfig.deepseek.apiKey
        ? "runtime"
        : process.env.DEEPSEEK_API_KEY
          ? "env"
          : "none",
      keyPreview: maskKey(providerConfig.deepseek.apiKey),
      model: providerConfig.deepseek.model
    },
    doubao: {
      configured: Boolean(providerConfig.doubao.apiKey),
      source: runtimeConfig.doubao.apiKey
        ? "runtime"
        : process.env.DOUBAO_API_KEY
          ? "env"
          : "none",
      keyPreview: maskKey(providerConfig.doubao.apiKey),
      model: providerConfig.doubao.model,
      apiUrl: providerConfig.doubao.apiUrl
    },
    mathpix: {
      configured: Boolean(getMathpixConfig().appId && getMathpixConfig().appKey),
      source:
        runtimeConfig.mathpix.appId || runtimeConfig.mathpix.appKey
          ? "runtime"
          : process.env.MATHPIX_APP_ID || process.env.MATHPIX_APP_KEY
            ? "env"
            : "none",
      appIdPreview: maskKey(getMathpixConfig().appId),
      appKeyPreview: maskKey(getMathpixConfig().appKey)
    },
    azureOcr: {
      configured: Boolean(azureConfig.endpoint && azureConfig.apiKey),
      source:
        runtimeConfig.azureOcr.endpoint || runtimeConfig.azureOcr.apiKey
          ? "runtime"
          : process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
            ? "env"
            : "none",
      endpoint: azureConfig.endpoint,
      keyPreview: maskKey(azureConfig.apiKey),
      model: azureConfig.model,
      apiVersion: azureConfig.apiVersion
    },
    awsTextract: {
      configured: Boolean(awsConfig.accessKeyId && awsConfig.secretAccessKey && awsConfig.region),
      source:
        runtimeConfig.awsTextract.accessKeyId || runtimeConfig.awsTextract.secretAccessKey
          ? "runtime"
          : process.env.AWS_TEXTRACT_ACCESS_KEY_ID || process.env.AWS_TEXTRACT_SECRET_ACCESS_KEY
            ? "env"
            : "none",
      accessKeyPreview: maskKey(awsConfig.accessKeyId),
      secretKeyPreview: maskKey(awsConfig.secretAccessKey),
      region: awsConfig.region
    }
  };
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
