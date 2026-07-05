const { RTSP_PATHS } = require('../utils/constants');

/**
 * @description Try to find a working RTSP path on a given camera IP, testing known
 * paths for common brands (Reolink, Dahua, Hikvision, CamHi, generic).
 * @param {string} ip - Camera IP address.
 * @param {string} [user] - RTSP username.
 * @param {string} [password] - RTSP password.
 * @param {number} [port] - RTSP port.
 * @returns {Promise<string|null>} The working RTSP URL, or null if none found.
 * @example
 * const url = await probeRtsp.call(this, '192.168.1.50', 'admin', 'admin');
 */
async function probeRtsp(ip, user = 'admin', password = 'admin', port = 554) {
  const reachable = await this.tcpReachable(ip, port);
  if (!reachable) {
    return null;
  }
  const encodedPassword = encodeURIComponent(password);
  // eslint-disable-next-line no-restricted-syntax
  for (const rtspPath of RTSP_PATHS) {
    const url = `rtsp://${user}:${encodedPassword}@${ip}:${port}${rtspPath}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await this.getSnapshot(url);
      return url;
    } catch (e) {
      // this path didn't work, try the next one
    }
  }
  return null;
}

module.exports = {
  probeRtsp,
};
