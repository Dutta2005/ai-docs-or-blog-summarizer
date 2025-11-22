document.addEventListener('DOMContentLoaded', init);

const $ = id => document.getElementById(id);

async function init() {
  const stored = await chrome.storage.local.get(['openai_api_key']);
  if (stored.openai_api_key) {
    $('api-key').value = stored.openai_api_key;
    $('key-status').textContent = '✓ API key saved';
  }

  $('save-key').addEventListener('click', saveApiKey);
  $('summarize-btn').addEventListener('click', summarizePage);
  $('copy-btn').addEventListener('click', copyToClipboard);
}

async function saveApiKey() {
  const key = $('api-key').value.trim();
  if (!key) {
    $('key-status').textContent = '✗ Please enter a valid key';
    $('key-status').style.color = '#f87171';
    return;
  }
  await chrome.storage.local.set({ openai_api_key: key });
  $('key-status').textContent = '✓ API key saved';
  $('key-status').style.color = '#4ade80';
}

async function summarizePage() {
  const stored = await chrome.storage.local.get(['openai_api_key']);
  const apiKey = stored.openai_api_key;

  if (!apiKey) {
    showError('Please save your OpenAI API key first.');
    return;
  }

  setLoading(true);
  hideError();
  $('result-container').classList.add('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: pageContent }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    if (!pageContent || pageContent.length < 100) {
      throw new Error('Could not extract enough content from this page.');
    }

    const summaryType = $('summary-type').value;
    const summary = await generateSummary(apiKey, pageContent, summaryType, tab.title);
    
    $('summary-result').textContent = summary;
    $('result-container').classList.remove('hidden');
  } catch (err) {
    showError(err.message || 'Failed to generate summary.');
  } finally {
    setLoading(false);
  }
}

function extractPageContent() {
  const selectors = ['article', 'main', '.post-content', '.entry-content', 
    '.article-content', '.content', '.documentation', '.markdown-body', '#content'];
  
  let content = '';
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
  content = content.replace(/\s+/g, ' ').trim();
  return content.slice(0, 12000);
}

async function generateSummary(apiKey, content, type, title) {
  const prompts = {
    brief: `Summarize this article in 2-3 clear sentences. Focus on the main point.`,
    detailed: `Provide a detailed summary with key points as bullet points. Include main arguments and conclusions.`,
    technical: `Summarize this technical documentation. Include: purpose, key concepts, important functions/methods, and usage notes.`
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that summarizes web content clearly and concisely.'
        },
        {
          role: 'user',
          content: `${prompts[type]}\n\nTitle: ${title}\n\nContent:\n${content}`
        }
      ],
      max_tokens: 1000,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function setLoading(loading) {
  $('summarize-btn').disabled = loading;
  $('btn-text').textContent = loading ? 'Summarizing...' : 'Summarize This Page';
  $('loader').classList.toggle('hidden', !loading);
}

function showError(msg) {
  $('error-msg').textContent = msg;
  $('error-msg').classList.remove('hidden');
}

function hideError() {
  $('error-msg').classList.add('hidden');
}

async function copyToClipboard() {
  const text = $('summary-result').textContent;
  await navigator.clipboard.writeText(text);
  $('copy-btn').textContent = 'Copied!';
  setTimeout(() => $('copy-btn').textContent = 'Copy to Clipboard', 2000);
}