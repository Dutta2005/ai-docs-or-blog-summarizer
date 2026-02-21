/**
 * Google Gemini Provider - Handles communication with Google Gemini API
 */

const GeminiProvider = {
  name: "Google Gemini",
  apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  defaultModel: "gemini-2.5-flash",

  /**
   * Generate summary using Google Gemini API
   * @param {string} apiKey - Gemini API key
   * @param {string} content - Page content to summarize
   * @param {string} type - Summary type (brief, detailed, technical)
   * @param {string} title - Page title
   * @param {AbortSignal} signal - Abort signal for timeout
   * @returns {Promise<string>} Generated summary
   */
  async generateSummary(apiKey, content, type, title, signal) {
    const prompts = {
      brief: `Summarize this article in 2-3 clear sentences. Focus on the main point.`,
      detailed: `Provide a detailed summary with key points as bullet points. Include main arguments and conclusions.`,
      technical: `Summarize this technical documentation. Include: purpose, key concepts, important functions/methods, and usage notes.`,
    };

    const systemPrompt =
      "You are a helpful assistant that summarizes web content clearly and concisely.";
    const userPrompt = `${prompts[type]}\n\nTitle: ${title}\n\nContent:\n${content}`;

    // Gemini API uses a different format - API key in URL, different request structure
    const url = `${this.apiEndpoint}/${this.defaultModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      signal: signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 1000,
        },
      }),
    });

    if (!response.ok) {
      let apiErrorMessage = null;
      try {
        const errorData = await response.json();
        apiErrorMessage = errorData.error?.message || null;
        console.error(`[Gemini API Error] HTTP ${response.status}: ${apiErrorMessage || response.statusText}`);
      } catch (parseErr) {
        console.error(`[Gemini API Error] HTTP ${response.status}: ${response.statusText} (non-JSON response)`);
      }
      throw { httpStatus: response.status, message: apiErrorMessage };
    }

    const data = await response.json();

    // Gemini response structure: data.candidates[0].content.parts[0].text
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error("[Gemini Invalid Response]", { data });
      throw { httpStatus: 500, message: "Invalid response structure from Gemini" };
    }

    return data.candidates[0].content.parts[0].text;
  },
};

// Export for use in popup.js
if (typeof window !== "undefined") {
  window.GeminiProvider = GeminiProvider;
}
