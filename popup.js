document.addEventListener("DOMContentLoaded", init);

const $ = (id) => document.getElementById(id);
let summary = null;

// Store last summarization context for retry functionality
let lastSummarizeContext = null;

// ============================================================================
// AUTO-SCROLL FUNCTIONS
// ============================================================================

/**
 * Scroll to the top of the result container with smooth behavior
 */
function scrollToTop() {
  const resultContainer = $("result-container");
  if (resultContainer) {
    resultContainer.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }
}

/**
 * Scroll to the bottom of the result container with smooth behavior
 */
function scrollToBottom() {
  const resultContainer = $("result-container");
  if (resultContainer) {
    resultContainer.scrollTo({
      top: resultContainer.scrollHeight,
      behavior: "smooth"
    });
  }
}

/**
 * Update scroll button visibility based on scroll position
 */
function updateScrollButtons() {
  const resultContainer = $("result-container");
  const scrollToTopBtn = $("scroll-to-top");
  const scrollToBottomBtn = $("scroll-to-bottom");
  
  if (!resultContainer || !scrollToTopBtn || !scrollToBottomBtn) return;
  
  const { scrollTop, scrollHeight, clientHeight } = resultContainer;
  
  // Show/hide scroll-to-top button based on scroll position
  if (scrollTop > 50) {
    scrollToTopBtn.classList.add("visible");
  } else {
    scrollToTopBtn.classList.remove("visible");
  }
  
  // Show/hide scroll-to-bottom button based on scroll position
  if (scrollTop + clientHeight < scrollHeight - 50) {
    scrollToBottomBtn.classList.add("visible");
  } else {
    scrollToBottomBtn.classList.remove("visible");
  }
}

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
 * Remove code blocks from content before sending to AI
 * Removes markdown code blocks, inline code, and HTML pre/code elements
 * @param {string} content - The page content
 * @returns {string} - Content with code blocks removed
 */
function stripCodeBlocks(content) {
  if (!content) return content;
  
  // Pattern 1: Remove markdown code blocks (```...```)
  let cleaned = content.replace(/```[\s\S]*?```/g, '');
  
  // Pattern 2: Remove inline code (`...`)
  cleaned = cleaned.replace(/`[^`]+`/g, '');
  
  // Pattern 3: Remove HTML pre and code tags and their content
  cleaned = cleaned.replace(/<pre>[\s\S]*?<\/pre>/gi, '');
  cleaned = cleaned.replace(/<code>[\s\S]*?<\/code>/gi, '');
  
  // Clean up extra whitespace created by removals
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/\s{3,}/g, ' ');
  
  return cleaned.trim();
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
    Consider using a shorter page or the summary may be truncated.</span>
  `;
  warningEl.classList.remove('hidden');
}

/**
 * Show trim notice in the UI
 * @param {number} originalLength - Original content length
 * @param {number} trimmedLength - Trimmed content length
 */

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
  $("theme-toggle").addEventListener("click", toggleTheme);
  $("retry-btn").addEventListener("click", retrySummarize);
  $("exclude-code-blocks").addEventListener("change", async (e) => {
    await chrome.storage.local.set({ exclude_code_blocks: e.target.checked });
  });

  // Scroll button event listeners
  $("scroll-to-top").addEventListener("click", scrollToTop);
  $("scroll-to-bottom").addEventListener("click", scrollToBottom);
  
  // Add scroll event listener to result container for button visibility
  const resultContainer = $("result-container");
  if (resultContainer) {
    resultContainer.addEventListener("scroll", updateScrollButtons);
  }

  // Load history on startup
  loadHistory();
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
        });
      pageContent = extractedContent.text;
      extractedImages = extractedContent.images || [];

      // Store context for retry
      lastSummarizeContext = {
        provider,
        apiKey,
        pageContent,
        summaryType: $("summary-type").value,
        title: tab.title,
        extractedImages
      };

      // Check if code blocks should be excluded
      const excludeCodeBlocks = $("exclude-code-blocks").checked;
      if (excludeCodeBlocks) {
        pageContent = stripCodeBlocks(pageContent);
      }

      // Display content word count and reading time
      updateContentStats(pageContent);

      // Check content limits and show warnings if needed

  const limitCheck = checkContentLimit(pageContent, provider);
  
  if (limitCheck.isOverLimit) {
    // Show warning before trimming
    showLimitWarning(limitCheck.estimatedTokens, limitCheck.safeLimit);
    
    // Calculate safe character limit
    const safeCharLimit = limitCheck.safeLimit * limitCheck.charsPerToken;
    
    // Trim content intelligently if it exceeds safe limit
    if (pageContent.length > safeCharLimit) {
      const originalLength = pageContent.length;
      pageContent = trimContent(pageContent, safeCharLimit);
      
      // Show trim notice
      showTrimNotice(originalLength, pageContent.length);
      
      // Update stored context with trimmed content
      lastSummarizeContext.pageContent = pageContent;
      
      // Update stats display with trimmed content
      updateContentStats(pageContent);
    }
  } else {
    // Hide any previous warnings
    hideLimitWarnings();
  }


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

    // Auto-scroll to top of result after generation
    scrollToTop();

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

/**
 * Retry the last summarization request
 */
async function retrySummarize() {
  if (!lastSummarizeContext) {
    showError("No previous request to retry. Please try again from the beginning.");
    return;
  }

  const { provider, apiKey, pageContent, summaryType, title, extractedImages, excludeCodeBlocks } = lastSummarizeContext;


  setLoading(true);
  hideError();
  hideRetryButton();
  $("result-container").classList.add("hidden");

  try {
    // Re-apply code block exclusion if it was enabled
    let contentToSend = pageContent;
    if (excludeCodeBlocks) {
      contentToSend = stripCodeBlocks(pageContent);
    }

    summary = await generateSummary(
      provider,
      apiKey,
      contentToSend,
      summaryType,
      title,
      extractedImages,
    );


    // Convert Markdown to raw HTML
    const rawHTML = marked.parse(summary);

    // Sanitize the raw HTML to strip out any malicious scripts or invalid tags
    const cleanHTML = DOMPurify.sanitize(rawHTML);

    // Safely inject sanitized HTML into the UI
    $("summary-result").innerHTML = cleanHTML;
    $("result-container").classList.remove("hidden");

    // Auto-scroll to top of result after generation
    scrollToTop();

    // Display summary word count and reading time
    updateSummaryStats(summary);

    // Save to history
    saveSummary(summary, title, "", summaryType);

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

  // Return full content for client-side trimming based on provider limits
  // The content will be intelligently trimmed in summarizePage() if needed
  return { text: content.slice(0, MAX_CONTENT_LENGTH), images };

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
  showRetryButton();
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
  hideLimitWarnings();
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
