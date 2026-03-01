# 📝 DashSummarize

A Chrome extension that uses OpenAI's GPT API to instantly generate summaries of any blog post, article, or documentation page.

![Chrome Extension](https://img.shields.io/badge/Platform-Chrome-green?logo=googlechrome)
![Version](https://img.shields.io/badge/Version-1.0.0-orange)

## ✨ Features

- **One-Click Summaries** - Instantly summarize any webpage with a single click
- **Multiple Summary Types**
  - 📌 **Brief** - Get the gist in 2-3 sentences
  - 📋 **Detailed** - Key points as organized bullet points
  - 🔧 **Technical** - Perfect for documentation with focus on concepts and usage
- **Smart Content Extraction** - Automatically detects and extracts article content from various website layouts
- **Secure API Key Storage** - Your OpenAI API key is stored locally in Chrome's secure storage
- **Copy to Clipboard** - Easily copy summaries with one click
- **Beautiful Dark UI** - Modern, clean interface that's easy on the eyes

## 🚀 Installation

1. **Clone the repository**
   
```
bash
   git clone https://github.com/Dutta2005/ai-page-summarizer.git
   cd ai-page-summarizer
   
```

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/` in your browser
   - Or go to Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the cloned repository folder

5. **Pin the extension** (optional)
   - Click the puzzle icon in Chrome toolbar
   - Pin "AI page summarizer" for easy access

## 🔧 Configuration

### Getting an OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in to your account
3. Navigate to **API Keys** section
4. Click **Create new secret key**
5. Copy the generated key (starts with `sk-`)

### Setting up the Extension

1. Click the extension icon in Chrome toolbar
2. Paste your OpenAI API key in the input field
3. Click **Save Key**
4. You'll see a confirmation message ✓

> ⚠️ **Note:** Your API key is stored locally on your device and is never shared with anyone except OpenAI for generating summaries.

## 📖 Usage

1. **Navigate** to any blog post, article, or documentation page
2. **Click** the AI page summarizer icon in your toolbar
3. **Select** your preferred summary type:
   - **Brief** - Quick overview in 2-3 sentences
   - **Detailed** - Comprehensive bullet-point summary
   - **Technical** - For docs, includes concepts, methods, and usage notes
4. **Click** "Summarize This Page"
5. **Wait** a few seconds for the AI to generate your summary
6. **Copy** the summary using the "Copy to Clipboard" button

## 🛠️ Tech Stack

- **Manifest V3** - Latest Chrome extension architecture
- **OpenAI GPT-4o-mini** - Fast and cost-effective AI model
- **Vanilla JavaScript** - No frameworks, lightweight and fast
- **Chrome Storage API** - Secure local storage for API keys
- **Chrome Scripting API** - Content extraction from web pages

## 📁 Project Structure

```
ai-page-summarizer/
├── manifest.json      # Extension configuration
├── popup.html         # Extension popup UI
├── popup.css          # Styling
├── popup.js           # Core logic & API integration
├── icon.png           # Icon of the extension
└── README.md
```


## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Ideas for Contributions

- [ ] Add support for other AI providers (Claude, Gemini)
- [ ] Implement summary history
- [ ] Add language translation option
- [ ] Create Firefox version
- [ ] Add keyboard shortcuts
- [ ] Export summaries as markdown/PDF


## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) for providing the GPT API
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Dutta2005">Raj Dutta</a>
</p>

<p align="center">
  ⭐ Star this repo if you find it useful!
</p>
