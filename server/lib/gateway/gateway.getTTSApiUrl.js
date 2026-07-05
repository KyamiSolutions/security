const get = require('get-value');
const logger = require('../../utils/logger');
const { Error403, Error429 } = require('../../utils/httpErrors');

/**
 * @description Check if the paid Gladys Plus gateway is configured on this instance.
 * @returns {Promise<boolean>} True when gateway credentials are present.
 * @example
 * const configured = await isGatewayConfigured.call(this);
 */
async function isGatewayConfigured() {
  const gladysGatewayRefreshToken = await this.variable.getValue('GLADYS_GATEWAY_REFRESH_TOKEN');
  const gladysGatewayRsaPrivateKey = await this.variable.getValue('GLADYS_GATEWAY_RSA_PRIVATE_KEY');
  const gladysGatewayEcdsaPrivateKey = await this.variable.getValue('GLADYS_GATEWAY_ECDSA_PRIVATE_KEY');
  return (
    gladysGatewayRefreshToken !== null && gladysGatewayRsaPrivateKey !== null && gladysGatewayEcdsaPrivateKey !== null
  );
}

/**
 * @description Get TTS token from Gateway. When no Gladys Plus subscription is configured
 * (only a free Groq/Gemini chat key), returns a null url so the front-end falls back to the
 * browser's own free speech synthesis instead of erroring out.
 * @param {object} body - The query to ask.
 * @returns {Promise} Resolve with TTS token response.
 * @example
 * getTTSApiUrl({
 *   text: 'Hello world',
 * })
 */
async function getTTSApiUrl(body) {
  const gatewayConfigured = await isGatewayConfigured.call(this);
  if (!gatewayConfigured) {
    return { url: null };
  }
  try {
    const response = await this.gladysGatewayClient.ttsGetToken(body);
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
  getTTSApiUrl,
};
