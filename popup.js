document.addEventListener("DOMContentLoaded", init);

const $ = (id) => document.getElementById(id);
let summary = null;

// ============================================================================
// ERROR HANDLING SYSTEM
// ============================================================================

const ERROR_TYPES = {
  NETWORK_ERROR: "network_error",
  UNAUTHORIZED: "unauthorized",
  RATE_LIMIT: "rate_limit",
  SERVER_ERROR: "server_error",
  TIMEOUT: "timeout",
  INVALID_RESPONSE: "invalid_response",
  CONTENT_EXTRACTION_FAILED: "content_extraction_failed",
  UNKNOWN: "unknown",
};

/**
 * User-friendly error messages (no technical jargon or raw API errors)
 */
const USER_MESSAGES = {
  network_error: "🌐 Network error: Please check your internet connection.",
  unauthorized:
    "🔑 Invalid API key. Please update your API key in the extension settings.",
  rate_limit:
    "⏱️ Rate limited: Too many requests. Please try again in a few moments.",
  server_error:
    "🔧 AI service temporarily unavailable. Please try again later.",
  timeout: "⏳ Request timed out. Please try again.",
  invalid_response: "⚠️ Unexpected response from AI service. Please try again.",
  content_extraction_failed:
    "Could not extract content from this page. Try a different page.",
  unknown: "❌ An unexpected error occurred. Please try again.",
};

/**
 * Classify errors into types and return user-friendly message + debug info
 * @param {Error} error - The caught error
 * @param {number} httpStatus - HTTP status code (if available)
 * @returns {Object} {type, userMessage, debugInfo}
 */
function classifyError(error, httpStatus = null) {
  // Network/fetch errors (TypeError)
  if (error instanceof TypeError) {
    if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("fetch")
    ) {
      return {
        type: ERROR_TYPES.NETWORK_ERROR,
        userMessage: USER_MESSAGES.network_error,
        debugInfo: error.message,
      };
    }
  }

  // Timeout (AbortError)
  if (error?.name === "AbortError") {
    return {
      type: ERROR_TYPES.TIMEOUT,
      userMessage: USER_MESSAGES.timeout,
      debugInfo: "Request aborted due to timeout",
    };
  }

  // HTTP status errors
  if (httpStatus) {
    if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) {
      return {
        type: ERROR_TYPES.UNAUTHORIZED,
        userMessage: USER_MESSAGES.unauthorized,
        debugInfo: `HTTP ${httpStatus}: Unauthorized / Bad API key`,
      };
    }
    if (httpStatus === 429) {
      return {
        type: ERROR_TYPES.RATE_LIMIT,
        userMessage: USER_MESSAGES.rate_limit,
        debugInfo: `HTTP 429: Rate limit exceeded`,
      };
    }
    if (httpStatus === 404) {
      return {
        type: ERROR_TYPES.UNKNOWN,
        userMessage: "🔍 AI model not found. The selected model may not be available for your API key.",
        debugInfo: `HTTP 404: Model not found`,
      };
    }
    if (httpStatus >= 500) {
      return {
        type: ERROR_TYPES.SERVER_ERROR,
        userMessage: USER_MESSAGES.server_error,
        debugInfo: `HTTP ${httpStatus}: Server error`,
      };
    }
  }

  // Unknown errors
  return {
    type: ERROR_TYPES.UNKNOWN,
    userMessage: USER_MESSAGES.unknown,
    debugInfo: error?.message || "Unknown error occurred",
  };
}

async function init() {
  // Load saved provider and API keys
  const stored = await chrome.storage.local.get([
    "ai_provider",
    "openai_api_key",
    "gemini_api_key",
    "claude_api_key",
  ]);

  // Set default provider to OpenAI for backward compatibility
  const currentProvider = stored.ai_provider || "openai";
  $("ai-provider").value = currentProvider;

  // Load saved API keys
  if (stored.openai_api_key) {
    $("openai-api-key").value = stored.openai_api_key;
  }
  if (stored.gemini_api_key) {
    $("gemini-api-key").value = stored.gemini_api_key;
  }
  if (stored.claude_api_key) {
    $("claude-api-key").value = stored.claude_api_key;
  }

  // Show the correct API key input group
  updateProviderUI(currentProvider);

  // Display key status if any key is saved
  const currentKey = stored[`${currentProvider}_api_key`];
  if (currentKey) {
    $("key-status").textContent = "✓ API key saved";
    $("key-status").style.color = "#4ade80";
  }

  // Event listeners
  $("ai-provider").addEventListener("change", handleProviderChange);
  $("save-openai-key").addEventListener("click", () => saveApiKey("openai"));
  $("save-gemini-key").addEventListener("click", () => saveApiKey("gemini"));
  $("save-claude-key").addEventListener("click", () => saveApiKey("claude"));
  $("summarize-btn").addEventListener("click", summarizePage);
  $("copy-md-btn").addEventListener("click", copyAsMarkdown);
  $("copy-plain-btn").addEventListener("click", copyAsPlainText);
  $("download-md-btn").addEventListener("click", downloadAsMarkdown);
  $("clear-history-btn").addEventListener("click", clearHistory);
  $("clear-summary-btn").addEventListener("click", clearSummary);

  // Load history on startup
  loadHistory();
}

/**
 * Handle provider selection change
 */
async function handleProviderChange() {
  const provider = $("ai-provider").value;
  await chrome.storage.local.set({ ai_provider: provider });
  updateProviderUI(provider);

  // Update key status based on selected provider
  const stored = await chrome.storage.local.get([`${provider}_api_key`]);
  const currentKey = stored[`${provider}_api_key`];
  if (currentKey) {
    $("key-status").textContent = "✓ API key saved";
    $("key-status").style.color = "#4ade80";
  } else {
    $("key-status").textContent = "";
  }
}

/**
 * Update UI to show/hide appropriate API key input
 */
function updateProviderUI(provider) {
  // Hide all API key groups
  $("openai-key-group").classList.add("hidden");
  $("gemini-key-group").classList.add("hidden");
  $("claude-key-group").classList.add("hidden");

  // Show the selected provider's API key group
  const targetGroup = $(`${provider}-key-group`);
  if (targetGroup) {
    targetGroup.classList.remove("hidden");
  }
}

async function saveApiKey(provider) {
  const key = $(`${provider}-api-key`).value.trim();
  if (!key) {
    $("key-status").textContent = "✗ Please enter a valid key";
    $("key-status").style.color = "#f87171";
    return;
  }
  await chrome.storage.local.set({ [`${provider}_api_key`]: key });
  $("key-status").textContent = "✓ API key saved";
  $("key-status").style.color = "#4ade80";
}

async function summarizePage() {
  summary = null;
  const stored = await chrome.storage.local.get([
    "ai_provider",
    "openai_api_key",
    "gemini_api_key",
    "claude_api_key",
  ]);

  const provider = stored.ai_provider || "openai";
  const apiKey = stored[`${provider}_api_key`];

  if (!apiKey) {
    showError("🔑 Please save your API key first.");
    return;
  }

  setLoading(true);
  hideError();
  $("result-container").classList.add("hidden");

  // Hoist these so they're accessible throughout the full try block
  let pageContent;
  let extractedImages = [];
  let tab;

  try {
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Guard: Chrome blocks content scripts on internal/restricted pages
      const restrictedPrefixes = ["chrome://", "chrome-extension://", "about:", "edge://", "file://"];
      if (restrictedPrefixes.some((prefix) => tab.url?.startsWith(prefix))) {
        setLoading(false);
        showError("🚫 Cannot summarize this page. Please open a website (e.g. a blog or docs page) and try again.");
        return;
      }

      const [{ result: extractedContent }] =
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageContent,
        });
      pageContent = extractedContent.text;
      extractedImages = extractedContent.images || [];

      // Show image indicator
      const providerObj = {
        openai: window.OpenAIProvider,
        gemini: window.GeminiProvider,
        claude: window.ClaudeProvider,
      }[provider];
      const imgIndicator = $("image-indicator");
      if (extractedImages.length > 0 && providerObj?.supportsMultimodal) {
        imgIndicator.textContent = `🖼️ ${extractedImages.length} image${extractedImages.length > 1 ? "s" : ""} detected — included in summary`;
        imgIndicator.className = "image-indicator img-found";
      } else if (extractedImages.length > 0) {
        imgIndicator.textContent = `🖼️ ${extractedImages.length} image${extractedImages.length > 1 ? "s" : ""} detected — not supported by this provider`;
        imgIndicator.className = "image-indicator img-skipped";
      } else {
        imgIndicator.textContent = "";
        imgIndicator.className = "image-indicator";
      }
    } catch (extractErr) {
      console.error("[Content Extraction Error]", extractErr);
      throw {
        type: ERROR_TYPES.CONTENT_EXTRACTION_FAILED,
        userMessage: USER_MESSAGES.content_extraction_failed,
        debugInfo: `Content extraction failed: ${extractErr?.message || "Unknown error"}`,
      };
    }

    // Validate extracted content
    if (!pageContent || pageContent.length < 100) {
      throw {
        type: ERROR_TYPES.CONTENT_EXTRACTION_FAILED,
        userMessage: USER_MESSAGES.content_extraction_failed,
        debugInfo: `Extracted content too short: ${pageContent?.length || 0} characters (minimum 100 required)`,
      };
    }

    const summaryType = $("summary-type").value;
    summary = await generateSummary(
      provider,
      apiKey,
      pageContent,
      summaryType,
      tab.title,
      extractedImages,
    );

    // Convert Markdown to raw HTML
    const rawHTML = marked.parse(summary);

    // Sanitize the raw HTML to strip out any malicious scripts or invalid tags
    const cleanHTML = DOMPurify.sanitize(rawHTML);

    // Safely inject sanitized HTML into the UI
    $("summary-result").innerHTML = cleanHTML;
    $("result-container").classList.remove("hidden");

    // Save to history
    saveSummary(summary, tab.title, tab.url, summaryType);

    // Refresh history list
    loadHistory();
  } catch (err) {
    // Check if error is already a structured error object from generateSummary()
    if (err && typeof err === "object" && err.type && err.userMessage) {
      // Already classified, use directly
      showError(err.userMessage);
      console.error("[Generate Summary Error]", {
        type: err.type,
        debugInfo: err.debugInfo,
        userMessage: err.userMessage,
      });
    } else {
      // New error (from content extraction, validation, etc.), classify it once
      const errorInfo = classifyError(err, null);
      showError(errorInfo.userMessage);
      console.error("[Generate Summary Error]", {
        type: errorInfo.type,
        debugInfo: errorInfo.debugInfo,
        originalMessage: err?.message,
      });
    }
  } finally {
    setLoading(false);
  }
}

function extractPageContent() {
  const selectors = [
    "article",
    "main",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".content",
    ".documentation",
    ".markdown-body",
    "#content",
  ];

  let content = "";
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      content = el.innerText;
      break;
    }
  }

  if (!content) {
    content = document.body.innerText;
  }

  // Clean and truncate text
  content = content.replace(/\s+/g, " ").trim();

  // Extract meaningful content images:
  // - Prefer images within article/main content containers
  // - Minimum 200x200px to filter out icons, avatars, and ads
  // - HTTPS only, max 2 images to keep API payload manageable
  const contentSelectors = ["article", "main", ".post-content", ".entry-content", ".markdown-body", "#content"];
  let imgPool = [];
  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      imgPool = Array.from(el.querySelectorAll("img"));
      break;
    }
  }
  if (imgPool.length === 0) {
    imgPool = Array.from(document.querySelectorAll("img"));
  }

  const images = imgPool
    .filter((img) => {
      const src = img.src || "";
      return (
        src.startsWith("https://") &&
        img.naturalWidth > 200 &&
        img.naturalHeight > 200
      );
    })
    .slice(0, 2)
    .map((img) => ({ url: img.src, alt: img.alt || "" }));

  return { text: content.slice(0, 12000), images };
}

/**
 * Generate summary with comprehensive error handling, timeout, and proper validation
 * Routes to the appropriate AI provider
 * @throws {Error} Throws user-friendly error messages
 */
async function generateSummary(provider, apiKey, content, type, title, images = []) {
  // Get the appropriate provider
  const providers = {
    openai: window.OpenAIProvider,
    gemini: window.GeminiProvider,
    claude: window.ClaudeProvider,
  };

  const aiProvider = providers[provider];
  if (!aiProvider) {
    throw {
      type: ERROR_TYPES.UNKNOWN,
      userMessage: `Unknown AI provider: ${provider}`,
      debugInfo: `Provider ${provider} not found`,
    };
  }

  // Only pass images if provider supports multimodal
  const imagesToPass = aiProvider.supportsMultimodal ? images : [];

  // Setup timeout (30 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // Call the provider's generateSummary method
    const result = await aiProvider.generateSummary(
      apiKey,
      content,
      type,
      title,
      controller.signal,
      imagesToPass,
    );
    return result;
  } catch (error) {
    // Handle timeout (AbortError)
    if (error?.name === "AbortError") {
      console.error("[Timeout Error]", "Request exceeded 30 second limit");
      const errorInfo = classifyError(error, null);
      throw errorInfo;
    }

    // Handle network errors (TypeError from fetch)
    if (error instanceof TypeError) {
      const errorInfo = classifyError(error, null);
      console.error("[Network Error]", errorInfo.debugInfo);
      throw errorInfo;
    }

    // Handle HTTP status errors from providers
    if (error.httpStatus) {
      const errorInfo = classifyError(
        new Error(error.message || `HTTP ${error.httpStatus}`),
        error.httpStatus,
      );
      // If the provider gave us a specific message, surface it to the user
      if (error.message && errorInfo.type === ERROR_TYPES.UNKNOWN) {
        errorInfo.userMessage = `❌ ${error.message}`;
      }
      console.error(`[Provider Error] HTTP ${error.httpStatus}: ${error.message || "(no message)"}`);
      throw errorInfo;
    }

    // Handle other errors
    const errorInfo = classifyError(error, null);
    console.error("[Generation Error]", errorInfo);
    throw errorInfo;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setLoading(loading) {
  $("summarize-btn").disabled = loading;
  $("btn-text").textContent = loading
    ? "Summarizing..."
    : "Summarize This Page";
  $("loader").classList.toggle("hidden", !loading);
}

/**
 * Enhanced error display with proper classification and logging
 * Shows user-friendly messages, hides technical details
 */
function showError(msg) {
  const errorElement = $("error-msg");
  errorElement.textContent = msg;
  errorElement.classList.remove("hidden");
  errorElement.style.display = "block";
  console.warn("[UI Error]", msg);
}

function hideError() {
  $("error-msg").classList.add("hidden");
}

function clearSummary() {
  summary = null;
  $("summary-result").textContent = "";
  $("result-container").classList.add("hidden");
  hideError();
}

async function copyAsMarkdown() {
  try {
    const text = summary;
    if (!text) {
      showError("📋 No summary to copy.");
      return;
    }
    await navigator.clipboard.writeText(text);
    $("copy-md-btn").textContent = "Copied as Markdown!";
    setTimeout(() => ($("copy-md-btn").textContent = "Copy as Markdown"), 2000);
  } catch (err) {
    console.error("[Clipboard Error]", err);
    showError("📋 Failed to copy. Try manual copy instead.");
  }
}

async function copyAsPlainText() {
  try {
    const text = $("summary-result")?.textContent;
    if (!text) {
      showError("📋 No summary to copy.");
      return;
    }
    await navigator.clipboard.writeText(text);
    $("copy-plain-btn").textContent = "Copied as Plain Text!";
    setTimeout(
      () => ($("copy-plain-btn").textContent = "Copy as Plain Text"),
      2000,
    );
  } catch (err) {
    console.error("[Clipboard Error]", err);
    showError("📋 Failed to copy. Try manual copy instead.");
  }
}


async function downloadAsMarkdown() {
  if (!summary) {
    showError("📋 No summary to download.");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageTitle = tab?.title || "Untitled Page";
    const pageUrl = tab?.url || "";
    const date = new Date().toISOString().split("T")[0];
    const provider = (await chrome.storage.local.get(["ai_provider"])).ai_provider || "openai";

    const fileContent = [
      `# ${pageTitle}`,
      ``,
      `> **Source:** ${pageUrl}`,
      `> **Date:** ${date}`,
      `> **Generated by:** ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
      ``,
      `---`,
      ``,
      summary,
    ].join("\n");

    const blob = new Blob([fileContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);

    const filename = pageTitle
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .toLowerCase()
      .slice(0, 50);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_summary.md`;
    a.click();
    URL.revokeObjectURL(url);

    $("download-md-btn").textContent = "✅ Downloaded!";
    setTimeout(() => ($("download-md-btn").textContent = "⬇️ Download as .md"), 2000);
  } catch (err) {
    console.error("[Download Error]", err);
    showError("📋 Failed to download. Try copying instead.");
  }
}

async function saveSummary(text, title, url, type) {
  try {
    const newSummary = {
      id: Date.now().toString(),
      text,
      title: title || "Untitled Page",
      url: url || "",
      type,
      date: new Date().toISOString()
    };

    const data = await chrome.storage.local.get(["summary_history"]);
    let history = data.summary_history || [];

    // Add new summary to the beginning
    history.unshift(newSummary);

    // Keep only last 10 items
    if (history.length > 10) {
      history = history.slice(0, 10);
    }

    await chrome.storage.local.set({ summary_history: history });
  } catch (err) {
    console.error("Failed to save summary:", err);
  }
}

async function loadHistory() {
  try {
    const data = await chrome.storage.local.get(["summary_history"]);
    const history = data.summary_history || [];
    renderHistory(history);
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

function renderHistory(historyItems) {
  const historyList = $("history-list");
  const historySection = $("history-section");

  historyList.innerHTML = "";

  if (historyItems.length === 0) {
    historySection.classList.add("hidden");
    return;
  }

  historySection.classList.remove("hidden");

  historyItems.forEach((item) => {
    const date = new Date(item.date).toLocaleDateString();

    const div = document.createElement("div");
    div.className = "history-item";
    const meta = document.createElement("div");
    meta.className = "history-meta";

    const dateSpan = document.createElement("span");
    dateSpan.textContent = date;

    const typeSpan = document.createElement("span");
    typeSpan.textContent = item.type || "summary";

    meta.appendChild(dateSpan);
    meta.appendChild(typeSpan);

    const title = document.createElement("div");
    title.className = "history-title";
    title.title = item.title || "Untitled Page";
    title.textContent = item.title || "Untitled Page";

    const preview = document.createElement("div");
    preview.className = "history-preview";
    const previewText = item.text ? item.text.slice(0, 100) : "";
    preview.textContent = previewText ? `${previewText}...` : "No summary text";

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-small copy-btn";
    copyBtn.dataset.id = item.id;
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";

    actions.appendChild(copyBtn);
    div.appendChild(meta);
    div.appendChild(title);
    div.appendChild(preview);
    div.appendChild(actions);

    // Create closure for copy button
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.text).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = originalText), 1500);
      });
    });

    historyList.appendChild(div);
  });
}

async function clearHistory() {
  if (confirm("Are you sure you want to clear your summary history?")) {
    await chrome.storage.local.remove("summary_history");
    renderHistory([]);
  }
}

