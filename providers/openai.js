/**
 * OpenAI Provider - Handles communication with OpenAI API
 * Supports multimodal summarization (text + images) via GPT-4o-mini vision
 */

const OpenAIProvider = {
  name: "OpenAI",
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  defaultModel: "gpt-4o-mini",
  supportsMultimodal: true,

  /**
   * Generate summary using OpenAI API (with optional image context)
   * @param {string} apiKey - OpenAI API key
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

    const textPrompt = `${prompts[type]}\n\nTitle: ${title}\n\nContent:\n${content}`;

    // Build multimodal content if images are provided
    const userContent =
      images.length > 0
        ? [
          { type: "text", text: textPrompt },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: img.url, detail: "low" },
          })),
        ]
        : textPrompt;

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      signal: signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.defaultModel,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes web content clearly and concisely." +
              (images.length > 0
                ? " The user has provided page images — use them to enrich your summary where relevant."
                : ""),
          },
          { role: "user", content: userContent },
        ],
        max_tokens: 1000,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      let apiErrorMessage = null;
      try {
        const errorData = await response.json();
        apiErrorMessage = errorData.error?.message;
        console.error(`[OpenAI API Error] HTTP ${response.status}: ${apiErrorMessage || response.statusText}`);
      } catch (parseErr) {
        console.error(`[OpenAI API Error] HTTP ${response.status}: ${response.statusText} (non-JSON response)`);
      }
      throw { httpStatus: response.status, message: apiErrorMessage };
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
      console.error("[OpenAI Invalid Response]", { data });
      throw { httpStatus: 500, message: "Invalid response structure from OpenAI" };
    }

    return data.choices[0].message.content;
  },
};

// Export for use in popup.js
if (typeof window !== "undefined") {
  window.OpenAIProvider = OpenAIProvider;
}
