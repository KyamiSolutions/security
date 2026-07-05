const get = require('get-value');
const logger = require('../../utils/logger');
const { Error403, Error429 } = require('../../utils/httpErrors');
const { askGemini } = require('./gateway.askGemini');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * @description Ask Groq's free OpenAI-compatible chat completion API, used as a free
 * alternative to the paid Gladys Gateway AI chat when a Groq API key is configured.
 * @param {object} body - OpenAI-compatible chat request body (messages, tools, tool_choice).
 * @param {string} apiKey - Groq API key.
 * @returns {Promise<object>} Chat completion response, OpenAI-shaped.
 * @example
 * askGroq({ messages: [{ role: 'user', content: 'Hello' }] }, 'gsk_...');
 */
async function askGroq(body, apiKey) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(Object.assign({ model: GROQ_MODEL }, body)),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = get(errorBody, 'error.message') || `Groq API returned ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      throw new Error403(message);
    }
    if (response.status === 429) {
      throw new Error429(message);
    }
    const error = new Error(message);
    error.response = { status: response.status, data: errorBody };
    throw error;
  }
  return response.json();
}

/**
 * @public
 * @description Ask an AI chat backend: the Gladys Gateway AI endpoint when a Gladys Plus
 * subscription is configured, otherwise Groq's free API when GROQ_API_KEY is set, falling
 * back to Google Gemini's free API when only GEMINI_API_KEY is set. When both free keys are
 * set, the AI_CHAT_PROVIDER preference ('groq' | 'gemini') decides which one is used, so e.g.
 * a Groq key added only for voice transcription doesn't silently take over text chat too.
 * @param {object} body - OpenAI-compatible chat request body.
 * @returns {Promise<object>} Chat completion-like response.
 * @example
 * aiChat({ messages: [{ role: 'user', content: 'Hello' }] });
 */
async function aiChat(body) {
  const groqApiKey = (await this.variable.getValue('GROQ_API_KEY')) || process.env.GROQ_API_KEY;
  const geminiApiKey = (await this.variable.getValue('GEMINI_API_KEY')) || process.env.GEMINI_API_KEY;
  const preferredProvider = await this.variable.getValue('AI_CHAT_PROVIDER');

  if (groqApiKey && geminiApiKey) {
    if (preferredProvider === 'gemini') {
      return askGemini(body, geminiApiKey);
    }
    return askGroq(body, groqApiKey);
  }
  if (groqApiKey) {
    return askGroq(body, groqApiKey);
  }
  if (geminiApiKey) {
    return askGemini(body, geminiApiKey);
  }
  try {
    const response = await this.gladysGatewayClient.openAIAsk(body);
    return response;
  } catch (e) {
    logger.debug(e);
    const status = get(e, 'response.status');
    const message = get(e, 'response.data.error_message');
    if (status === 403) {
      throw new Error403(message);
    }
    if (status === 429) {
      throw new Error429(message);
    }
    throw e;
  }
}

module.exports = {
  aiChat,
};
