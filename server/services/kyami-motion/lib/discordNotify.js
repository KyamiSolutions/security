const logger = require('../../../utils/logger');

/**
 * @description Send a motion-detection snapshot to a Discord webhook, if one is configured
 * via the DISCORD_WEBHOOK_URL environment variable.
 * @param {string|number} source - The camera source the snapshot came from (for the message text).
 * @param {Buffer} jpegBuffer - The JPEG snapshot to attach.
 * @returns {Promise<void>} Resolves once the webhook call finishes (errors are only logged).
 * @example
 * await notifyDiscord.call(this, 'rtsp://...', jpegBuffer);
 */
async function notifyDiscord(source, jpegBuffer) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
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
