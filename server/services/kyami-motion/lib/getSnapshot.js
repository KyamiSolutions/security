const fse = require('fs-extra');
const path = require('path');

const logger = require('../../../utils/logger');

/**
 * @description Grab a single JPEG frame from an RTSP URL or a local USB device (/dev/videoX).
 * @param {string|number} source - RTSP URL (string) or USB device index (number).
 * @returns {Promise<Buffer>} JPEG frame bytes.
 * @example
 * const jpeg = await getSnapshot.call(this, 'rtsp://user:pass@192.168.1.50:554/h264Preview_01_main');
 */
async function getSnapshot(source) {
  const isRtsp = typeof source === 'string' && source.startsWith('rtsp://');
  const now = Date.now();
  const filePath = path.join(this.gladys.config.tempFolder, `kyami-motion-snapshot-${now}-${Math.random()}.jpg`);

  const args = [];
  if (isRtsp) {
    args.push('-rtsp_transport', 'tcp');
  } else {
    args.push('-f', 'v4l2');
  }
  args.push('-i', isRtsp ? source : `/dev/video${source}`, '-f', 'image2', '-vframes', '1', '-qscale:v', '5', filePath);

  await fse.ensureDir(this.gladys.config.tempFolder);

  return new Promise((resolve, reject) => {
    this.childProcess.execFile(
      'ffmpeg',
      args,
      { timeout: 8 * 1000 },
      async (error) => {
        if (error) {
          await fse.remove(filePath).catch(() => {});
          reject(error);
          return;
        }
        try {
          const buffer = await fse.readFile(filePath);
          resolve(buffer);
        } catch (e) {
          reject(e);
        } finally {
          await fse.remove(filePath).catch(() => {});
        }
      },
    );
  }).catch((e) => {
    logger.debug(`kyami-motion: snapshot failed for ${isRtsp ? source : `/dev/video${source}`}: ${e.message}`);
    throw e;
  });
}

module.exports = {
  getSnapshot,
};
