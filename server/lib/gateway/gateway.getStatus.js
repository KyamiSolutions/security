/**
 * @description Return if gateway is connected.
 * @returns {Promise} Return status.
 * @example
 * getStatus();
 */
async function getStatus() {
  const gladysGatewayRefreshToken = await this.variable.getValue('GLADYS_GATEWAY_REFRESH_TOKEN');
  const gladysGatewayRsaPrivateKey = await this.variable.getValue('GLADYS_GATEWAY_RSA_PRIVATE_KEY');
  const gladysGatewayEcdsaPrivateKey = await this.variable.getValue('GLADYS_GATEWAY_ECDSA_PRIVATE_KEY');

  const configured =
    gladysGatewayRefreshToken !== null && gladysGatewayRsaPrivateKey !== null && gladysGatewayEcdsaPrivateKey !== null;

  const groqApiKey = (await this.variable.getValue('GROQ_API_KEY')) || process.env.GROQ_API_KEY;
  const geminiApiKey = (await this.variable.getValue('GEMINI_API_KEY')) || process.env.GEMINI_API_KEY;

  return {
    configured,
    connected: this.connected,
    // AI chat also works without a Gladys Plus subscription when a free Groq or Gemini API key is set.
    aiChatAvailable: configured || Boolean(groqApiKey) || Boolean(geminiApiKey),
  };
}

module.exports = {
  getStatus,
};
