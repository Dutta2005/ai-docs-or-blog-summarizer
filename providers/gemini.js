/**
 * Google Gemini Provider - Handles communication with Google Gemini API
 * Supports multimodal summarization (text + images) via inline base64 image data
 */

const GeminiProvider = {
  name: "Google Gemini",
  apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  defaultModel: "gemini-2.0-flash",
  supportsMultimodal: true,

  /**
   * Fetch an image URL and convert it to base64 for the Gemini inline_data format
   * @param {string} url - Image URL
   * @returns {Promise<{data: string, mimeType: string}|null>}
   */
  async _fetchImageAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const mimeType = blob.type || "image/jpeg";
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // Strip the "data:image/...;base64," prefix
          const base64 = reader.result.split(",")[1];
          resolve({ data: base64, mimeType });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  },

  /**
   * Generate summary using Google Gemini API (with optional image context)
   * @param {string} apiKey - Gemini API key
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

    // Build parts: start with the text part
    const parts = [{ text: `${systemPrompt}\n\n${userPrompt}` }];

    // Fetch and attach images as base64 inline_data
    // Cap total image payload to ~3MB to stay within Gemini limits
    if (images.length > 0) {
      const imageResults = await Promise.all(
        images.map((img) => this._fetchImageAsBase64(img.url))
      );
      let payloadBytes = 0;
      const MAX_IMAGE_PAYLOAD = 3 * 1024 * 1024; // 3MB
      for (const imgData of imageResults) {
        if (imgData) {
          const imgBytes = imgData.data.length * 0.75; // base64 → bytes approx
          if (payloadBytes + imgBytes > MAX_IMAGE_PAYLOAD) break;
          payloadBytes += imgBytes;
          parts.push({
            inline_data: {
              mime_type: imgData.mimeType,
              data: imgData.data,
            },
          });
        }
      }
      if (parts.length === 1) {
        // All images failed or were too large — log and continue text-only
        console.warn("[Gemini] No images could be included — falling back to text-only");
      }
    }

    const url = `${this.apiEndpoint}/${this.defaultModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      signal: signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
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
