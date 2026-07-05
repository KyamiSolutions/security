const fse = require('fs-extra');

const MAX_USB_INDEX = 8;

/**
 * @description List USB video devices (/dev/video0..7) that exist on this host.
 * @returns {Promise<number[]>} List of USB camera indexes found.
 * @example
 * const cameras = await listUsbCameras.call(this);
 */
async function listUsbCameras() {
  const found = [];
  for (let i = 0; i < MAX_USB_INDEX; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await fse.pathExists(`/dev/video${i}`);
    if (exists) {
      found.push(i);
    }
  }
  return found;
}

module.exports = {
  listUsbCameras,
};
