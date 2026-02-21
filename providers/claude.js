/**
 * Claude (Anthropic) Provider - Handles communication with Claude API
 * Supports multimodal summarization (text + images) via URL image sources
 */

const ClaudeProvider = {
  name: "Claude (Anthropic)",
  apiEndpoint: "https://api.anthropic.com/v1/messages",
  defaultModel: "claude-sonnet-4-6",

  /**
   * Generate summary using Claude API (with optional image context)
   * @param {string} apiKey - Claude API key
   * @param {string} content - Page content to summarize
   * @param {string} type - Summary type (brief, detailed, technical)
   * @param {string} title - Page title
   * @param {AbortSignal} signal - Abort signal for timeout
   * @param {Array<{url: string, alt: string}>} images - Optional page images
   * @returns {Promise<string>} Generated summary
   */
  async generateSummary(apiKey, content, type, title, signal, images = []) {
    const prompts = {
      brief: `Summarize this article in 2-3 clear sentences. Focus on the main point.`,
      detailed: `Provide a detailed summary with key points as bullet points. Include main arguments and conclusions.`,
      technical: `Summarize this technical documentation. Include: purpose, key concepts, important functions/methods, and usage notes.`,
    };

    const systemPrompt =
      "You are a helpful assistant that summarizes web content clearly and concisely." +
      (images.length > 0
        ? " The user has provided page images — use them to enrich your summary where relevant."
        : "");

    const userPrompt = `${prompts[type]}\n\nTitle: ${title}\n\nContent:\n${content}`;

    // Build multimodal content if images are provided
    // Claude supports URL image sources directly
    const userContent =
      images.length > 0
        ? [
          { type: "text", text: userPrompt },
          ...images.map((img) => ({
            type: "image",
            source: { type: "url", url: img.url },
          })),
        ]
        : userPrompt;

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      signal: signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: this.defaultModel,
        max_tokens: 1000,
        messages: [{ role: "user", content: userContent }],
        system: systemPrompt,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      let apiErrorMessage = null;
      try {
        const errorData = await response.json();
        apiErrorMessage = errorData.error?.message;
        console.error(`[Claude API Error] HTTP ${response.status}: ${apiErrorMessage || response.statusText}`);
      } catch (parseErr) {
        console.error(`[Claude API Error] HTTP ${response.status}: ${response.statusText} (non-JSON response)`);
      }
      throw { httpStatus: response.status, message: apiErrorMessage };
    }

    const data = await response.json();

    // Claude response structure: data.content[0].text
    if (!data.content?.[0]?.text) {
      console.error("[Claude Invalid Response]", { data });
      throw { httpStatus: 500, message: "Invalid response structure from Claude" };
    }

    return data.content[0].text;
  },
};

// Export for use in popup.js
if (typeof window !== "undefined") {
  window.ClaudeProvider = ClaudeProvider;
}
