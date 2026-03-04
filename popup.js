document.addEventListener("DOMContentLoaded", init);

const $ = (id) => document.getElementById(id);
let summary = null;

// Store last summarization context for retry functionality
let lastSummarizeContext = null;

// ============================================================================
// WORD COUNT & READING TIME UTILITIES
// ============================================================================

/**
 * Count words in a text string
 * @param {string} text - The text to count words in
 * @returns {number} - Number of words
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Calculate estimated reading time based on word count
 * Uses average reading speed of 200 words per minute
 * @param {number} wordCount - Number of words
 * @returns {string} - Formatted reading time string
 */
function calculateReadingTime(wordCount) {
  const wordsPerMinute = 200;
  const minutes = Math.ceil(wordCount / wordsPerMinute);
  
  if (minutes < 1) {
    return '< 1 min';
  } else if (minutes === 1) {
    return '1 min';
  } else {
    return `${minutes} mins`;
  }
}

/**
 * Format word count with proper separator
 * @param {number} count - Word count
 * @returns {string} - Formatted word count string
 */
function formatWordCount(count) {
  return count.toLocaleString();
}

/**
 * Update content stats display (before summarization)
 * @param {string} content - The extracted page content
 */
function updateContentStats(content) {
  const contentStatsEl = $('content-stats');
  if (!contentStatsEl) return;
  
  const wordCount = countWords(content);
  const readingTime = calculateReadingTime(wordCount);
  
  contentStatsEl.innerHTML = `
    <span class="stat-item">
      <span class="stat-label">Words:</span>
      <span class="stat-value">${formatWordCount(wordCount)}</span>
    </span>
    <span class="stat-item">
      <span class="stat-label">Reading time:</span>
      <span class="stat-value">${readingTime}</span>
    </span>
  `;
  contentStatsEl.classList.remove('hidden');
}

/**
 * Update summary stats display (after summarization)
 * @param {string} summaryText - The generated summary
 */
function updateSummaryStats(summaryText) {
  const summaryStatsEl = $('summary-stats');
  if (!summaryStatsEl) return;
  
  const wordCount = countWords(summaryText);
  const readingTime = calculateReadingTime(wordCount);
  
  summaryStatsEl.innerHTML = `
    <span class="stat-item">
      <span class="stat-label">Words:</span>
      <span class="stat-value">${formatWordCount(wordCount)}</span>
    </span>
    <span class="stat-item">
      <span class="stat-label">Reading time:</span>
      <span class="stat-value">${readingTime}</span>
    </span>
  `;
}

/**
 * Scroll the generated summary results area to the top
 */
function scrollToTop() {
  const resultsContainer = $("result-container");

  if (resultsContainer) {
    resultsContainer.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Scroll the generated summary results area to the bottom
 */
function scrollToBottom() {
  const resultsContainer = $("result-container");

  if (resultsContainer) {
    resultsContainer.scrollTo({ top: resultsContainer.scrollHeight, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

// ============================================================================
// TOKEN LIMIT & CONTENT TRIMMING UTILITIES
// ============================================================================

/**
 * Estimate token count from character count
 * Uses approximate ratio of 4 characters per token
 * @param {number} charCount - Number of characters
 * @returns {number} - Estimated token count
 */
function estimateTokens(charCount) {
  return Math.ceil(charCount / 4);
}

/**
 * Check if content exceeds safe token limits for a provider
 * @param {string} content - The content to check
 * @param {string} provider - The AI provider name
 * @returns {Object} - { isOverLimit: boolean, estimatedTokens: number, safeLimit: number }
 */
function checkContentLimit(content, provider) {
  const limits = TOKEN_LIMITS[provider] || TOKEN_LIMITS.openai;
  const estimatedTokens = estimateTokens(content.length);
  
  return {
    isOverLimit: estimatedTokens > limits.safeLimit,
    estimatedTokens,
    safeLimit: limits.safeLimit,
    maxTokens: limits.maxTokens,
    charsPerToken: limits.charsPerToken,
  };
}

/**
 * Intelligently trim content to fit within token limit
 * Tries to preserve complete sentences and important content
 * @param {string} content - The content to trim
 * @param {number} maxChars - Maximum characters allowed
 * @returns {string} - Trimmed content
 */
function trimContent(content, maxChars) {
  if (content.length <= maxChars) {
    return content;
  }
  
  // Try to trim at a sentence boundary
  const trimmed = content.slice(0, maxChars);
  
  // Find the last sentence ending (., !, ? followed by space or end)
  const lastSentenceEnd = Math.max(
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('! '),
    trimmed.lastIndexOf('? ')
  );
  
  if (lastSentenceEnd > maxChars * 0.8) {
    // If we found a sentence end in the last 20%, use it
    return trimmed.slice(0, lastSentenceEnd + 1);
  }
  
  // Otherwise, try to trim at a word boundary
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.9) {
    return trimmed.slice(0, lastSpace);
  }
  
  return trimmed;
}

/**
 * Remove common code block patterns from extracted page text
 * (fenced blocks, inline code markers, and heavily-indented code lines)
 * @param {string} content - Raw extracted content
 * @returns {string} - Content with code-heavy sections reduced
 */
function stripCodeBlocks(content) {
  if (!content || typeof content !== "string") {
    return "";
  }

  let cleaned = content;

  // Remove fenced code blocks: ```...``` or ~~~...~~~
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
  cleaned = cleaned.replace(/~~~[\s\S]*?~~~/g, " ");

  // Remove inline code snippets enclosed with backticks
  cleaned = cleaned.replace(/`[^`\n]+`/g, " ");

  // Remove lines that look like code (4+ leading spaces / tab)
  cleaned = cleaned
    .split("\n")
    .filter((line) => !/^\s{4,}|^\t/.test(line))
    .join("\n");

  // Normalize whitespace after removals
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Show limit warning in the UI
 * @param {number} estimatedTokens - Estimated token count
 * @param {number} safeLimit - Safe token limit for the provider
 */
function showLimitWarning(estimatedTokens, safeLimit) {
  const warningEl = $('limit-warning');
  if (!warningEl) return;
  
  warningEl.innerHTML = `
    <span>Content is very long (~${estimatedTokens.toLocaleString()} tokens). 
    May exceed ${safeLimit.toLocaleString()} token safe limit. 
    Consider using a shorter page or the summary may be truncated. Estimate is approximate — may vary for code or non-Latin text.</span>
  `;
  warningEl.classList.remove('hidden');
}

/**
 * Show trim notice in the UI
 * @param {number} originalLength - Original content length
 * @param {number} trimmedLength - Trimmed content length
 */
function showTrimNotice(originalLength, trimmedLength) {
  const noticeEl = $('trim-notice');
  if (!noticeEl) return;
  
  const percentKept = Math.round((trimmedLength / originalLength) * 100);
  const tokensSaved = estimateTokens(originalLength - trimmedLength);
  
  noticeEl.innerHTML = `
    <span>Content automatically trimmed from ${originalLength.toLocaleString()} to 
    ${trimmedLength.toLocaleString()} characters (${percentKept}% kept, ~${tokensSaved} tokens saved) 
    to fit within safe limits.</span>
  `;
  noticeEl.classList.remove('hidden');
}

/**
 * Hide limit warning and trim notice
 */
function hideLimitWarnings() {
  const warningEl = $('limit-warning');
  const noticeEl = $('trim-notice');
  if (warningEl) warningEl.classList.add('hidden');
  if (noticeEl) noticeEl.classList.add('hidden');
}


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

// ============================================================================
// TOKEN LIMIT CONFIGURATION
// ============================================================================

/**
 * Token limits for each AI provider (in tokens)
 * These are conservative limits to ensure safe operation
 */
const TOKEN_LIMITS = {
  openai: {
    maxTokens: 128000,    // GPT-4o-mini context window
    safeLimit: 100000,    // Conservative limit for safety
    charsPerToken: 4,     // Approximate chars per token
  },
  gemini: {
    maxTokens: 1048576,   // Gemini 2.5 Flash context window
    safeLimit: 800000,    // Conservative limit
    charsPerToken: 4,
  },
  claude: {
    maxTokens: 200000,    // Claude Sonnet context window
    safeLimit: 150000,    // Conservative limit
    charsPerToken: 4,
  },
};

/**
 * Model display names mapping for UI badge
 */
const MODEL_DISPLAY_NAMES = {
  openai: "GPT-4o-mini",
  gemini: "Gemini 2.5 Flash",
  claude: "Claude Sonnet 4.6",
};

/**
 * Maximum content length to extract (increased from 12000)
 * This allows for larger pages while still being manageable
 */
const MAX_CONTENT_LENGTH = 400000;


/**
 * User-friendly error messages (no technical jargon or raw API errors)
 */
const USER_MESSAGES = {
  network_error: "🌐 Network error: Please check your internet connection.",
  unauthorized:
    "🔑 Invalid API key. Please update your API key in the extension settings.",
  forbidden:
    "🚫 Request blocked by the AI provider. Check provider requirements and account permissions.",
  bad_request:
    "⚠️ Request rejected by AI service. Check model name, account access, or request format.",
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
  const errorMessage = (error?.message || "").toLowerCase();

  if (
    errorMessage.includes("dangerous-direct-browser-access") ||
    errorMessage.includes("browser")
  ) {
    return {
      type: ERROR_TYPES.UNAUTHORIZED,
      userMessage:
        "⚠️ Claude browser request blocked. The extension must send Anthropic's browser-access header.",
      debugInfo: error?.message || "Browser access restriction",
    };
  }

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
    if (httpStatus === 400) {
      return {
        type: ERROR_TYPES.INVALID_RESPONSE,
        userMessage: USER_MESSAGES.bad_request,
        debugInfo: `HTTP 400: Bad request`,
      };
    }
    if (httpStatus === 401) {
      return {
        type: ERROR_TYPES.UNAUTHORIZED,
        userMessage: USER_MESSAGES.unauthorized,
        debugInfo: `HTTP ${httpStatus}: Unauthorized / Bad API key`,
      };
    }
    if (httpStatus === 403) {
      return {
        type: ERROR_TYPES.UNAUTHORIZED,
        userMessage: USER_MESSAGES.forbidden,
        debugInfo: `HTTP 403: Forbidden`,
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
    "theme",
    "exclude_code_blocks",
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

  // Load and apply saved theme (default to dark)
  const savedTheme = stored.theme || "dark";
  applyTheme(savedTheme);

  // Load exclude code blocks preference
  $("exclude-code-blocks").checked = stored.exclude_code_blocks || false;

  // Show the correct API key input group
  updateProviderUI(currentProvider);


  // Display key status if any key is saved
  const currentKey = stored[`${currentProvider}_api_key`];
  if (currentKey) {
    $("key-status").textContent = "✓ API key saved";
    $("key-status").style.color = "#4ade80";
  }

  // Update button state based on API key presence
  updateSummarizeButtonState(currentProvider);

  // Event listeners
  $("ai-provider").addEventListener("change", handleProviderChange);
  $("save-openai-key").addEventListener("click", () => saveApiKey("openai"));
  $("save-gemini-key").addEventListener("click", () => saveApiKey("gemini"));
  $("save-claude-key").addEventListener("click", () => saveApiKey("claude"));
  
  // Password toggle event listeners
  initPasswordToggles();
  
  $("summarize-btn").addEventListener("click", summarizePage);
  $("copy-md-btn").addEventListener("click", copyAsMarkdown);
  $("copy-plain-btn").addEventListener("click", copyAsPlainText);
  $("download-md-btn").addEventListener("click", downloadAsMarkdown);
  $("clear-history-btn").addEventListener("click", clearHistory);
  $("clear-summary-btn").addEventListener("click", clearSummary);
  $("scroll-to-top").addEventListener("click", scrollToTop);
  $("scroll-to-bottom").addEventListener("click", scrollToBottom);
  $("theme-toggle").addEventListener("click", toggleTheme);
  $("retry-btn").addEventListener("click", retrySummarize);

  // Load history on startup
  loadHistory();

  // Auto-click summarize button if opened via keyboard shortcut
  const shortcutData = await chrome.storage.session.get(['autoSummarize']);
  if (shortcutData.autoSummarize) {
    await chrome.storage.session.remove(['autoSummarize']);
    setTimeout(() => $("summarize-btn")?.click(), 100);
  }
}


/**
 * Apply the theme to the body
 * @param {string} theme - 'dark' or 'light'
 */
function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-theme");
    $("theme-icon").textContent = "☀️";
  } else {
    document.body.classList.remove("light-theme");
    $("theme-icon").textContent = "🌙";
  }
}

/**
 * Toggle between dark and light theme
 */
async function toggleTheme() {
  const isLightTheme = document.body.classList.contains("light-theme");
  const newTheme = isLightTheme ? "dark" : "light";
  
  // Apply the new theme
  applyTheme(newTheme);
  
  // Save the theme preference to Chrome Storage
  await chrome.storage.local.set({ theme: newTheme });
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

  // Update summarize button state based on API key presence
  updateSummarizeButtonState(provider);
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

async function updateSummarizeButtonState(provider) {
  const stored = await chrome.storage.local.get([`${provider}_api_key`]);
  const apiKey = stored[`${provider}_api_key`];
  const helperEl = $("api-key-helper");
  const btnEl = $("summarize-btn");

  if (apiKey) {
    btnEl.disabled = false;
    helperEl.classList.add("hidden");
  } else {
    btnEl.disabled = true;
    helperEl.classList.remove("hidden");
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

  // Update summarize button state based on API key presence
  updateSummarizeButtonState(provider);
}

async function summarizePage() {
  summary = null;
  lastSummarizeContext = null;
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
  hideRetryButton();
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
    args: [Math.min(
      MAX_CONTENT_LENGTH,
      (TOKEN_LIMITS[provider] || TOKEN_LIMITS.openai).safeLimit *
        (TOKEN_LIMITS[provider] || TOKEN_LIMITS.openai).charsPerToken
    )],
  });
      pageContent = extractedContent.text;
      extractedImages = extractedContent.images || [];

      // Check if code blocks should be excluded
      const excludeCodeBlocks = $("exclude-code-blocks").checked;
      if (excludeCodeBlocks) {
        pageContent = stripCodeBlocks(pageContent);
      }

      // Display content word count and reading time
      updateContentStats(pageContent);

      // Check content limits and show warnings if needed
      let trimmedContent = pageContent;
      const limitCheck = checkContentLimit(trimmedContent, provider);

      if (limitCheck.isOverLimit) {
        // Show warning before trimming
        showLimitWarning(limitCheck.estimatedTokens, limitCheck.safeLimit);

        // Calculate safe character limit
        const safeCharLimit = limitCheck.safeLimit * limitCheck.charsPerToken;

        // Trim content intelligently if it exceeds safe limit
        if (trimmedContent.length > safeCharLimit) {
          const originalLength = trimmedContent.length;
          trimmedContent = trimContent(trimmedContent, safeCharLimit);

          // Show trim notice
          showTrimNotice(originalLength, trimmedContent.length);

          // Update stats display with trimmed content
          updateContentStats(trimmedContent);
        }
      } else {
        // Hide any previous warnings
        hideLimitWarnings();
      }

      pageContent = trimmedContent;


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

    // Store validated context for retry
    lastSummarizeContext = {
      provider,
      apiKey,
      pageContent,
      summaryType,
      title: tab.title,
      url: tab.url,
      extractedImages,
    };

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
    // Update model badge to show which model generated the summary
    updateModelBadge(provider);

    // Safely inject sanitized HTML into the UI
    $("summary-result").innerHTML = cleanHTML;
    $("result-container").classList.remove("hidden");

    // Automatically scroll to the top when a new summary is shown
    scrollToTop();
    // Update model badge to show which model generated the summary
    updateModelBadge(provider);

    // Display summary word count and reading time
    updateSummaryStats(summary);

    // Save to history
    saveSummary(summary, tab.title, tab.url, summaryType);

    // Refresh history list
    loadHistory();
  } catch (err) {
    // Check if error is already a structured error object from generateSummary()
    if (err && typeof err === "object" && err.type && err.userMessage) {
      // Already classified, use directly
      showError(err.userMessage);
      if (lastSummarizeContext !== null) {
        showRetryButton();
      }
      console.error("[Generate Summary Error]", {
        type: err.type,
        debugInfo: err.debugInfo,
        userMessage: err.userMessage,
      });
    } else {
      // New error (from content extraction, validation, etc.), classify it once
      const errorInfo = classifyError(err, null);
      showError(errorInfo.userMessage);
      if (lastSummarizeContext !== null) {
        showRetryButton();
      }
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

/**
 * Retry the last summarization request
 */
async function retrySummarize() {
  if (!lastSummarizeContext) {
    hideRetryButton();
    showError("No previous request to retry. Please try again from the beginning.");
    return;
  }

  const { provider, apiKey, pageContent, summaryType, title, url, extractedImages } = lastSummarizeContext;

  if (!pageContent || pageContent.length < 100) {
    showError(USER_MESSAGES.content_extraction_failed);
    hideRetryButton();
    return;
  }

  $("retry-btn").disabled = true;
  setLoading(true);
  hideError();
  hideRetryButton();
  $("result-container").classList.add("hidden");

  try {
    summary = await generateSummary(
      provider,
      apiKey,
      pageContent,
      summaryType,
      title,
      extractedImages,
      url,
    );

    // Convert Markdown to raw HTML
    const rawHTML = marked.parse(summary);

    // Sanitize the raw HTML to strip out any malicious scripts or invalid tags
    const cleanHTML = DOMPurify.sanitize(rawHTML);

    // Safely inject sanitized HTML into the UI
    $("summary-result").innerHTML = cleanHTML;
    $("result-container").classList.remove("hidden");

    // Update model badge to show which model generated the summary
    updateModelBadge(provider);

    // Display summary word count and reading time
    updateSummaryStats(summary);

    // Save to history
    saveSummary(summary, title, url || "", summaryType);

    // Refresh history list
    loadHistory();
  } catch (err) {
    // Check if error is already a structured error object from generateSummary()
    if (err && typeof err === "object" && err.type && err.userMessage) {
      // Already classified, use directly
      showError(err.userMessage);
      if (lastSummarizeContext !== null) {
        showRetryButton();
      }
      console.error("[Generate Summary Error]", {
        type: err.type,
        debugInfo: err.debugInfo,
        userMessage: err.userMessage,
      });
    } else {
      // New error (from content extraction, validation, etc.), classify it once
      const errorInfo = classifyError(err, null);
      showError(errorInfo.userMessage);
      if (lastSummarizeContext !== null) {
        showRetryButton();
      }
      console.error("[Generate Summary Error]", {
        type: errorInfo.type,
        debugInfo: errorInfo.debugInfo,
        originalMessage: err?.message,
      });
    }
  } finally {
    setLoading(false);
    $("retry-btn").disabled = false;
  }
}

function extractPageContent(maxLength) {
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

  // Return full content for client-side trimming based on provider limits
  // The content will be intelligently trimmed in summarizePage() if needed
  return { text: content.slice(0, maxLength), images };

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
  if (loading) {
    $("summarize-btn").disabled = true;
  } else {
    const provider = $("ai-provider")?.value || "openai";
    updateSummarizeButtonState(provider);
  }
  $("retry-btn").disabled = loading;
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
  if (lastSummarizeContext) {
    showRetryButton();
  } else {
    hideRetryButton();
  }
  console.warn("[UI Error]", msg);
}

function hideError() {
  $("error-msg").classList.add("hidden");
}

/**
 * Show the retry button when an error occurs
 */
function showRetryButton() {
  $("retry-btn").classList.remove("hidden");
}

/**
 * Hide the retry button
 */
function hideRetryButton() {
  $("retry-btn").classList.add("hidden");
}

function clearSummary() {
  summary = null;
  $("summary-result").textContent = "";
  $("result-container").classList.add("hidden");
  hideError();
  hideRetryButton();
  lastSummarizeContext = null;
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

// ============================================================================
// PASSWORD VISIBILITY TOGGLE
// ============================================================================

/**
 * Initialize password visibility toggle buttons for all API key inputs
 */
function initPasswordToggles() {
  const toggleButtons = document.querySelectorAll('.password-toggle');
  
  toggleButtons.forEach(button => {
    button.addEventListener('click', function() {
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      
      if (input) {
        // Toggle input type between password and text
        if (input.type === 'password') {
          input.type = 'text';
          // Show the hide icon (🔒), hide the show icon (👁️)
          this.querySelector('.eye-icon').classList.add('hidden');
          this.querySelector('.eye-icon:last-child').classList.remove('hidden');
        } else {
          input.type = 'password';
          // Show the show icon (👁️), hide the hide icon (🔒)
          this.querySelector('.eye-icon').classList.remove('hidden');
          this.querySelector('.eye-icon:last-child').classList.add('hidden');
        }
      }
    });
  });
}
