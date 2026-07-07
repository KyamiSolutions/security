const logger = require('../../../utils/logger');

/**
 * @description Post a message (with an optional JPEG attachment) to a Discord webhook.
 * @param {string} webhookUrl - Discord webhook URL.
 * @param {string} content - Message text.
 * @param {Buffer} [jpegBuffer] - Optional JPEG image to attach.
 * @returns {Promise<{success: boolean, status: number|null, error: string|null}>} Result.
 * @example
 * await sendDiscordMessage('https://discord.com/api/webhooks/...', 'Hello');
 */
async function sendDiscordMessage(webhookUrl, content, jpegBuffer) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content }));
  if (jpegBuffer) {
    form.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'motion.jpg');
  }

  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: form });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn(`kyami-motion: Discord webhook returned ${response.status}: ${body}`);
      return { success: false, status: response.status, error: body || `HTTP ${response.status}` };
    }
    return { success: true, status: response.status, error: null };
  } catch (e) {
    logger.warn(`kyami-motion: Discord webhook call failed: ${e.message}`);
    return { success: false, status: null, error: e.message };
  }
}

/**
 * @description Send a motion-detection snapshot to a Discord webhook, if one is configured
 * (either saved through the kyami-motion settings page, or via the DISCORD_WEBHOOK_URL
 * environment variable as a fallback).
 * @param {string|number} source - The camera source the snapshot came from (for the message text).
 * @param {Buffer} jpegBuffer - The JPEG snapshot to attach.
 * @returns {Promise<void>} Resolves once the webhook call finishes (errors are only logged).
 * @example
 * await notifyDiscord.call(this, 'rtsp://...', jpegBuffer);
 */
async function notifyDiscord(source, jpegBuffer) {
  const config = await this.getConfig();
  const webhookUrl = config.discordWebhookUrl;
  if (!webhookUrl) {
    return;
  }
  const label = typeof source === 'number' ? `USB kaamera ${source}` : 'kaamera';
  await sendDiscordMessage(webhookUrl, `🚨 Liikumine tuvastatud: ${label}`, jpegBuffer);
}

/**
 * @description Send a test message to the configured Discord webhook, so connectivity can be
 * verified without waiting for real motion (useful when managing the system remotely).
 * @returns {Promise<{success: boolean, status: number|null, error: string|null}>} Result.
 * @example
 * const result = await sendTestNotification.call(this);
 */
async function sendTestNotification() {
  const config = await this.getConfig();
  const webhookUrl = config.discordWebhookUrl;
  if (!webhookUrl) {
    return { success: false, status: null, error: 'NO_WEBHOOK_CONFIGURED' };
  }
  return sendDiscordMessage(webhookUrl, '✅ KyamiSecurity: test teavitus. Kui sa seda näed, töötab Discord webhook.');
}

module.exports = {
  notifyDiscord,
  sendTestNotification,
};
