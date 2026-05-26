const runtimeConfig = {
  preferredProvider: process.env.PREFERRED_TRANSLATION_PROVIDER || "auto",
  openai: {
    apiKey: "",
    model: ""
  },
  deepseek: {
    apiKey: "",
    model: ""
  }
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

  if (input.clearOpenAI === true) {
    runtimeConfig.openai.apiKey = "";
  }

  if (input.clearDeepSeek === true) {
    runtimeConfig.deepseek.apiKey = "";
  }

  return getModelKeyStatus();
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
    }
  };
}

export function getModelKeyStatus() {
  const providerConfig = getProviderConfig();
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
    }
  };
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "********";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
