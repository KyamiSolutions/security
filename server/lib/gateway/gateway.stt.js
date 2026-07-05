const get = require('get-value');
const logger = require('../../utils/logger');
const { Error403, Error429 } = require('../../utils/httpErrors');

const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3';

/**
 * @description Transcribe audio via Groq's free Whisper API, used instead of the paid Gladys
 * Gateway STT when a free Groq API key is configured.
 * @param {Buffer} audio - Raw audio buffer.
 * @param {string} contentType - Audio MIME type from the client.
 * @param {string} apiKey - Groq API key.
 * @returns {Promise<object>} STT response, shaped like `{ text }`.
 * @example
 * askGroqStt(audioBuffer, 'audio/wav', 'gsk_...');
 */
async function askGroqStt(audio, contentType, apiKey) {
  const form = new FormData();
  const extension = (contentType.split('/')[1] || 'wav').split(';')[0];
  form.append('file', new Blob([audio], { type: contentType }), `audio.${extension}`);
  form.append('model', GROQ_STT_MODEL);

  const response = await fetch(GROQ_STT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = get(errorBody, 'error.message') || `Groq STT API returned ${response.status}`;
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
 * @description Transcribe audio: Groq's free Whisper API when a Groq API key is configured,
 * otherwise the paid Gladys Gateway STT API.
 * @param {Buffer} audio - Raw audio buffer.
 * @param {string} [contentType='application/octet-stream'] - Audio MIME type from the client.
 * @returns {Promise<object>} STT API response.
 * @example
 * stt(audioBuffer, 'audio/wav');
 */
async function stt(audio, contentType = 'application/octet-stream') {
  const groqApiKey = (await this.variable.getValue('GROQ_API_KEY')) || process.env.GROQ_API_KEY;
  if (groqApiKey) {
    return askGroqStt(audio, contentType, groqApiKey);
  }
  try {
    const response = await this.gladysGatewayClient.stt(audio, contentType);
    return response;
  } catch (e) {
    logger.warn(e);
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
  stt,
};
