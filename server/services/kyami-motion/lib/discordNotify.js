const logger = require('../../../utils/logger');

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
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: `🚨 Liikumine tuvastatud: ${label}` }));
  form.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'motion.jpg');

  try {
    const response = await fetch(webhookUrl, { method: 'POST', body: form });
    if (!response.ok) {
      logger.warn(`kyami-motion: Discord webhook returned ${response.status}`);
    }
  } catch (e) {
    logger.warn(`kyami-motion: Discord webhook call failed: ${e.message}`);
  }
}

module.exports = {
  notifyDiscord,
};
