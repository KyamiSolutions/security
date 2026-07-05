const get = require('get-value');
const { Error403, Error429 } = require('../../utils/httpErrors');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * @description Convert an OpenAI-style message "content" (string, or array of text/image_url
 * parts) into Gemini "parts".
 * @param {string|Array} content - OpenAI-style message content.
 * @returns {Array} Gemini parts.
 * @example
 * contentToParts([{ type: 'text', text: 'hi' }]);
 */
function contentToParts(content) {
  if (!content) {
    return [{ text: '' }];
  }
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  return content
    .map((part) => {
      if (part.type === 'text') {
        return { text: part.text };
      }
      if (part.type === 'image_url') {
        const url = part.image_url && part.image_url.url;
        const match = url && url.match(/^data:(.+);base64,(.+)$/);
        if (match) {
          return { inlineData: { mimeType: match[1], data: match[2] } };
        }
        return null;
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * @description Convert OpenAI-style chat `messages` (incl. system prompt, tool calls and tool
 * results) into Gemini's `{ systemInstruction, contents }` shape.
 * @param {Array} messages - OpenAI-style messages array.
 * @returns {object} Gemini systemInstruction + contents.
 * @example
 * messagesToGeminiPayload([{ role: 'user', content: 'hi' }]);
 */
function messagesToGeminiPayload(messages) {
  const systemParts = [];
  const contents = [];

  messages.forEach((message) => {
    if (message.role === 'system') {
      systemParts.push({ text: message.content });
      return;
    }
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.name || 'tool_result',
              response: { result: message.content },
            },
          },
        ],
      });
      return;
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      contents.push({
        role: 'model',
        parts: message.tool_calls.map((toolCall) => ({
          functionCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
          },
        })),
      });
      return;
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: contentToParts(message.content),
    });
  });

  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
  };
}

/**
 * @description Convert OpenAI-style `tools` (function definitions) into Gemini's
 * `functionDeclarations` shape.
 * @param {Array} tools - OpenAI-style tools array.
 * @returns {Array|undefined} Gemini tools array.
 * @example
 * toolsToGeminiTools([{ type: 'function', function: { name: 'x', parameters: {} } }]);
 */
function toolsToGeminiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined;
  }
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    },
  ];
}

/**
 * @description Convert a Gemini `generateContent` response back into an OpenAI-shaped chat
 * completion response, so the rest of the AI chat code can stay provider-agnostic.
 * @param {object} geminiResponse - Raw Gemini API response.
 * @returns {object} OpenAI-shaped response with `choices[0].message`.
 * @example
 * geminiResponseToOpenAiShape(response);
 */
function geminiResponseToOpenAiShape(geminiResponse) {
  const parts = get(geminiResponse, 'candidates.0.content.parts') || [];
  const textParts = parts.filter((part) => part.text).map((part) => part.text);
  const functionCallParts = parts.filter((part) => part.functionCall);

  const message = {
    role: 'assistant',
    content: textParts.length ? textParts.join('\n') : null,
  };

  if (functionCallParts.length > 0) {
    message.tool_calls = functionCallParts.map((part, index) => ({
      id: `gemini-call-${index}`,
      type: 'function',
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {}),
      },
    }));
  }

  return { choices: [{ message }] };
}

/**
 * @description Ask Google Gemini's free API, translating from/to the OpenAI-compatible shape
 * used by the rest of the AI chat code. Used as a free fallback when GROQ_API_KEY isn't set
 * but GEMINI_API_KEY is.
 * @param {object} body - OpenAI-compatible chat request body (messages, tools, tool_choice).
 * @returns {Promise<object>} OpenAI-shaped chat completion response.
 * @example
 * askGemini({ messages: [{ role: 'user', content: 'Hello' }] });
 */
async function askGemini(body) {
  const { systemInstruction, contents } = messagesToGeminiPayload(body.messages || []);
  const payload = {
    contents,
    systemInstruction,
    tools: toolsToGeminiTools(body.tools),
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = get(errorBody, 'error.message') || `Gemini API returned ${response.status}`;
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

  const geminiResponse = await response.json();
  return geminiResponseToOpenAiShape(geminiResponse);
}

module.exports = {
  askGemini,
};
