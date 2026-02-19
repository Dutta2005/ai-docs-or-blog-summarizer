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
    "🔑 Invalid API key. Please update your OpenAI API key in the extension settings.",
  rate_limit:
    "⏱️ Rate limited: Too many requests. Please try again in a few moments.",
  server_error:
    "🔧 OpenAI service temporarily unavailable. Please try again later.",
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
    if (httpStatus === 401) {
      return {
        type: ERROR_TYPES.UNAUTHORIZED,
        userMessage: USER_MESSAGES.unauthorized,
        debugInfo: `HTTP 401: Unauthorized`,
      };
    }
    if (httpStatus === 429) {
      return {
        type: ERROR_TYPES.RATE_LIMIT,
        userMessage: USER_MESSAGES.rate_limit,
        debugInfo: `HTTP 429: Rate limit exceeded`,
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
  const stored = await chrome.storage.local.get(["openai_api_key"]);
  if (stored.openai_api_key) {
    $("api-key").value = stored.openai_api_key;
    $("key-status").textContent = "✓ API key saved";
  }

  $("save-key").addEventListener("click", saveApiKey);
  $("summarize-btn").addEventListener("click", summarizePage);
  $("copy-md-btn").addEventListener("click", copyAsMarkdown);
  $("copy-plain-btn").addEventListener("click", copyAsPlainText);
  $("clear-summary-btn").addEventListener("click", clearSummary);
}

async function saveApiKey() {
  const key = $("api-key").value.trim();
  if (!key) {
    $("key-status").textContent = "✗ Please enter a valid key";
    $("key-status").style.color = "#f87171";
    return;
  }
  await chrome.storage.local.set({ openai_api_key: key });
  $("key-status").textContent = "✓ API key saved";
  $("key-status").style.color = "#4ade80";
}

async function summarizePage() {
  summary = null;
  const stored = await chrome.storage.local.get(["openai_api_key"]);
  const apiKey = stored.openai_api_key;

  if (!apiKey) {
    showError("🔑 Please save your OpenAI API key first.");
    return;
  }

  setLoading(true);
  hideError();
  $("result-container").classList.add("hidden");

  try {
    let pageContent;
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const [{ result: extractedContent }] =
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageContent,
        });
      pageContent = extractedContent;
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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    summary = await generateSummary(
      apiKey,
      pageContent,
      summaryType,
      tab.title,
    );

    // Convert Markdown to raw HTML
    const rawHTML = marked.parse(summary);

    // Sanitize the raw HTML to strip out any malicious scripts or invalid tags
    const cleanHTML = DOMPurify.sanitize(rawHTML);

    // Safely inject sanitized HTML into the UI
    $("summary-result").innerHTML = cleanHTML;
    $("result-container").classList.remove("hidden");
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

  // Clean and truncate
  content = content.replace(/\s+/g, " ").trim();
  return content.slice(0, 12000);
}

/**
 * Generate summary with comprehensive error handling, timeout, and proper validation
 * @throws {Error} Throws user-friendly error messages
 */
async function generateSummary(apiKey, content, type, title) {
  const prompts = {
    brief: `Summarize this article in 2-3 clear sentences. Focus on the main point.`,
    detailed: `Provide a detailed summary with key points as bullet points. Include main arguments and conclusions.`,
    technical: `Summarize this technical documentation. Include: purpose, key concepts, important functions/methods, and usage notes.`,
  };

  // Setup timeout (30 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // Make API request with timeout
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes web content clearly and concisely.",
          },
          {
            role: "user",
            content: `${prompts[type]}\n\nTitle: ${title}\n\nContent:\n${content}`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.5,
      }),
    });

    // Handle non-OK responses
    if (!response.ok) {
      let apiErrorMessage = null;

      // Try to extract error details from API response
      try {
        const errorData = await response.json();
        apiErrorMessage = errorData.error?.message;

        // Log full error for debugging
        console.error("[API Error Debug]", {
          status: response.status,
          errorData: errorData,
        });
      } catch (parseErr) {
        // Response was not JSON (e.g., network error, server error)
        console.error("[API Error - Non-JSON Response]", {
          status: response.status,
          statusText: response.statusText,
        });
      }

      // Classify error and get user-friendly message
      const errorInfo = classifyError(
        new Error(apiErrorMessage || `HTTP ${response.status}`),
        response.status,
      );

      console.error("[Classified Error]", {
        type: errorInfo.type,
        debugInfo: errorInfo.debugInfo,
      });

      throw errorInfo; // Throw structured object, not new Error
    }

    // Parse successful response
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error("[Response Parse Error]", parseErr);
      const errorInfo = classifyError(parseErr, null);
      throw errorInfo; // Throw structured object
    }

    // Validate response structure
    if (!data.choices?.[0]?.message?.content) {
      console.error("[Invalid Response Structure]", {
        hasChoices: !!data.choices,
        hasMessage: !!data.choices?.[0]?.message,
        data: data,
      });
      const errorInfo = classifyError(
        new Error("Invalid response structure"),
        null,
      );
      throw errorInfo; // Throw structured object
    }

    return data.choices[0].message.content;
  } catch (error) {
    // Handle specific error types

    // Timeout (AbortError)
    if (error?.name === "AbortError") {
      console.error("[Timeout Error]", "Request exceeded 30 second limit");
      const errorInfo = classifyError(error, null);
      throw errorInfo; // Throw structured object
    }

    // Network errors (TypeError from fetch)
    if (error instanceof TypeError) {
      const errorInfo = classifyError(error, null);
      console.error("[Network Error]", errorInfo.debugInfo);
      throw errorInfo; // Throw structured object
    }

    // Re-throw already processed structured errors
    throw error;
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

function clearSummary() {
  summary = null;
  $("summary-result").innerHTML = "";
  $("result-container").classList.add("hidden");
  hideError();
}
