const childProcess = require('child_process');
const fse = require('fs-extra');

const logger = require('../../utils/logger');
const KyamiMotionHandler = require('./lib');
const KyamiMotionController = require('./api/kyamiMotion.controller');

/**
 * @description Gladys service porting KyamiSecurity's camera/motion features: multi-brand
 * RTSP auto-discovery, USB/v4l2 camera control and local motion-triggered recording.
 * @param {object} gladys - The Gladys instance.
 * @returns {object} The service.
 * @example
 * gladys.services['kyami-motion'].start();
 */
module.exports = function KyamiMotionService(gladys) {
  const device = new KyamiMotionHandler(gladys, childProcess);

  /**
   * @public
   * @description This function starts the service.
   * @returns {Promise<void>} Resolves once the service is started.
   * @example
   * gladys.services['kyami-motion'].start();
   */
  async function start() {
    logger.info('Starting kyami-motion service');
    await fse.ensureDir(gladys.config.tempFolder);
    await fse.ensureDir(gladys.config.recordingsFolder);
  }

  /**
   * @public
   * @description This function stops the service.
   * @returns {Promise<void>} Resolves once the service is stopped.
   * @example
   * gladys.services['kyami-motion'].stop();
   */
  async function stop() {
    logger.info('Stopping kyami-motion service');
    Object.keys(device.detectors).forEach((source) => device.stopMotionDetector(source));
  }

  return Object.freeze({
    start,
    stop,
    device,
    controllers: KyamiMotionController(gladys, device),
  });
};
