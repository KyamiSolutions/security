const net = require('net');

/**
 * @description Check if a TCP port is reachable on a given host.
 * @param {string} ip - Target IP address.
 * @param {number} port - Target TCP port.
 * @param {number} [timeout] - Timeout in milliseconds.
 * @returns {Promise<boolean>} True if the port accepted a connection.
 * @example
 * await tcpReachable('192.168.1.50', 554);
 */
function tcpReachable(ip, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

module.exports = {
  tcpReachable,
};
