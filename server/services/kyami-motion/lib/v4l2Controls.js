const logger = require('../../../utils/logger');

/**
 * @description Read the current v4l2 controls (brightness, contrast, etc.) of a USB camera.
 * @param {number} usbIndex - USB camera index (/dev/videoX).
 * @returns {Promise<object>} Map of control name to integer value.
 * @example
 * const controls = await getV4l2Controls.call(this, 0);
 */
function getV4l2Controls(usbIndex) {
  const device = `/dev/video${usbIndex}`;
  return new Promise((resolve) => {
    this.childProcess.execFile(
      'v4l2-ctl',
      [`--device=${device}`, '--list-ctrls'],
      { timeout: 5 * 1000 },
      (error, stdout) => {
        if (error) {
          logger.debug(`kyami-motion: unable to read v4l2 controls for ${device}: ${error.message}`);
          resolve({});
          return;
        }
        const controls = {};
        stdout.split('\n').forEach((rawLine) => {
          const line = rawLine.trim();
          if (!line || !line.includes(':')) {
            return;
          }
          const [namePart, rest] = line.split(/:(.+)/);
          const name = namePart.trim().split(/\s+/)[0];
          rest.split(/\s+/).forEach((token) => {
            if (token.startsWith('value=')) {
              const value = parseInt(token.split('=')[1], 10);
              if (!Number.isNaN(value)) {
                controls[name] = value;
              }
            }
          });
        });
        resolve(controls);
      },
    );
  });
}

/**
 * @description Set a single v4l2 control (e.g. brightness, contrast) on a USB camera.
 * @param {number} usbIndex - USB camera index (/dev/videoX).
 * @param {string} control - Control name, as reported by getV4l2Controls.
 * @param {number} value - New value for the control.
 * @returns {Promise<void>} Resolves once the control has been applied.
 * @example
 * await setV4l2Control.call(this, 0, 'brightness', 128);
 */
function setV4l2Control(usbIndex, control, value) {
  const device = `/dev/video${usbIndex}`;
  return new Promise((resolve) => {
    this.childProcess.execFile(
      'v4l2-ctl',
      [`--device=${device}`, `--set-ctrl=${control}=${value}`],
      { timeout: 5 * 1000 },
      (error) => {
        if (error) {
          logger.warn(`kyami-motion: unable to set v4l2 control ${control} on ${device}: ${error.message}`);
        }
        resolve();
      },
    );
  });
}

module.exports = {
  getV4l2Controls,
  setV4l2Control,
};
