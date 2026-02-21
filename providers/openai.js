/**
 * OpenAI Provider - Handles communication with OpenAI API
 */

const OpenAIProvider = {
  name: "OpenAI",
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  defaultModel: "gpt-4o-mini",

  /**
   * Generate summary using OpenAI API
   * @param {string} apiKey - OpenAI API key
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

    if (!response.ok) {
      let apiErrorMessage = null;
      try {
        const errorData = await response.json();
        apiErrorMessage = errorData.error?.message;
        console.error("[OpenAI API Error]", {
          status: response.status,
          errorData: errorData,
        });
      } catch (parseErr) {
        console.error("[OpenAI API Error - Non-JSON Response]", {
          status: response.status,
          statusText: response.statusText,
        });
      }
      throw { httpStatus: response.status, message: apiErrorMessage };
    }

    const data = await response.json();

    if (!data.choices?.[0]?.message?.content) {
      console.error("[OpenAI Invalid Response]", { data });
      throw new Error("Invalid response structure from OpenAI");
    }

    return data.choices[0].message.content;
  },
};

// Export for use in popup.js
if (typeof window !== "undefined") {
  window.OpenAIProvider = OpenAIProvider;
}
