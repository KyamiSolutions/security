const fse = require('fs-extra');
const path = require('path');

/**
 * @description Path to the small JSON file kyami-motion uses to persist its own settings
 * (currently just the Discord webhook URL), stored next to the recordings.
 * @returns {string} Absolute path to the config file.
 * @example
 * const file = configFilePath.call(this);
 */
function configFilePath() {
  return path.join(this.gladys.config.recordingsFolder, 'kyami-motion-config.json');
}

/**
 * @description Read kyami-motion's persisted config, falling back to the DISCORD_WEBHOOK_URL
 * environment variable if nothing has been saved yet through the UI.
 * @returns {Promise<object>} The config object, e.g. { discordWebhookUrl }.
 * @example
 * const config = await getConfig.call(this);
 */
async function getConfig() {
  let config;
  try {
    config = await fse.readJson(configFilePath.call(this));
  } catch (e) {
    config = { discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '' };
  }
  if (!Array.isArray(config.sources)) {
    config.sources = [];
  }
  return config;
}

/**
 * @description Persist kyami-motion's config to disk.
 * @param {object} partialConfig - Fields to merge into the existing config.
 * @returns {Promise<object>} The full config after the update.
 * @example
 * await saveConfig.call(this, { discordWebhookUrl: 'https://discord.com/api/webhooks/...' });
 */
async function saveConfig(partialConfig) {
  const current = await getConfig.call(this);
  const next = Object.assign({}, current, partialConfig);
  await fse.ensureDir(this.gladys.config.recordingsFolder);
  await fse.writeJson(configFilePath.call(this), next);
  return next;
}

module.exports = {
  getConfig,
  saveConfig,
};
