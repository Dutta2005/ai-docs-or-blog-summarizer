## ✨ Multi-Provider Architecture + Multimodal Summarization Support

**Closes #[issue-number]**

### 📝 Summary

This PR refactors the extension to support **multiple AI providers** through a clean provider abstraction layer, and lays the groundwork for **multimodal summarization** (text + images) for models that support it. Providers now expose capability metadata so the extension can gracefully fall back to text-only mode when image context is unsupported.

---

### 🔄 Changes Made

#### New Files
- `providers/openai.js` — OpenAI GPT-4o-mini provider (`supportsMultimodal: true`)
- `providers/gemini.js` — Google Gemini 2.0 Flash provider (`supportsMultimodal: true`)
- `providers/claude.js` — Claude 3 Haiku provider (`supportsMultimodal: true`)

#### Modified Files
- `popup.html` — AI Provider dropdown + per-provider API key input groups
- `popup.js` — Provider routing, `handleProviderChange()`, `updateProviderUI()`, image detection logic, graceful multimodal fallback, and improved error classification
- `manifest.json` — Added `host_permissions` for Gemini and Claude API endpoints

---

### 🏗️ Architecture

Each provider module exposes a consistent interface:

```js
const XProvider = {
  name: "Provider Name",
  apiEndpoint: "https://...",
  defaultModel: "model-name",
  supportsMultimodal: true | false,
  async generateSummary(apiKey, content, type, title, signal) { ... }
};
```

`popup.js` routes summarization to the selected provider at runtime:

```js
const providers = {
  openai: window.OpenAIProvider,
  gemini: window.GeminiProvider,
  claude: window.ClaudeProvider,
};
const result = await providers[selectedProvider].generateSummary(...);
```

---

### ✅ Expected Behavior Implemented

- [x] Users can select between OpenAI, Gemini, and Claude from the UI
- [x] Each provider's API key is stored independently via `chrome.storage.local`
- [x] OpenAI remains the default provider for backward compatibility
- [x] Provider choice persists across popup sessions
- [x] Clear error messages for invalid keys (HTTP 400/401/403), rate limits (429), and model not found (404)
- [x] `supportsMultimodal` metadata added to all providers for future image-context routing

---

### 🧪 Testing

- [x] Switching providers shows the correct API key input and label
- [x] Saved keys persist per-provider after closing the popup
- [x] Summarization routes correctly to the selected provider
- [x] Invalid/missing API keys show provider-specific error messages
- [x] Graceful fallback to text-only when multimodal is unavailable

---

### 🔗 Related

- Resolves: *"Upgrade extension to support multiple AI providers and multimodal inputs"*
- See `MULTI_PROVIDER_GUIDE.md` for per-provider setup instructions
