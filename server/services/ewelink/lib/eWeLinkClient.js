const crypto = require('crypto');
const WebSocket = require('ws');
const logger = require('../../../utils/logger');

// Publicly known, working eWeLink "app" credentials used by the actively-maintained
// open-source homebridge-ewelink project (MIT licensed). The credentials embedded in the
// abandoned `ewelink-api` npm package (last updated 2020) were blocked by Sonoff in 2023;
// these are a different, still-functional pair, with no developer registration required.
const APP_ID = 'Uw83EKZFxdif7XFXEsrpduz5YyjP7nTl';
const APP_SECRET = 'mXLOjea0woSMvK9gw7Fjsy7YlFO4iSu6';

const REGION_HOSTS = {
  eu: 'eu-apia.coolkit.cc',
  us: 'us-apia.coolkit.cc',
  as: 'as-apia.coolkit.cc',
  cn: 'cn-apia.coolkit.cn',
};
const DEFAULT_HOST = REGION_HOSTS.eu;

/**
 * @description Sign a request body the way the eWeLink app does (HMAC-SHA256, base64).
 * @param {object} body - JSON request body.
 * @returns {string} Base64-encoded signature.
 * @example
 * sign({ email: 'a@b.com', password: 'x' });
 */
function sign(body) {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
}

/**
 * @description Build the standard headers for an eWeLink v2 HTTP request.
 * @param {string} [bearerToken] - Access token, if the request is authenticated.
 * @returns {object} Headers object.
 * @example
 * buildHeaders(this.at);
 */
function buildHeaders(bearerToken) {
  const headers = {
    'Content-Type': 'application/json',
    'X-CK-Appid': APP_ID,
    'X-CK-Nonce': crypto.randomBytes(4).toString('hex'),
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  return headers;
}

/**
 * @description Flatten a v2 API "itemData" device object into the flat shape the rest of the
 * eWeLink service code expects (deviceid, uiid, productModel, online, params, ...).
 * @param {object} itemData - Raw device data from the v2 API.
 * @returns {object} Flat device object.
 * @example
 * flattenDevice(itemData);
 */
function flattenDevice(itemData) {
  const extra = itemData.extra || {};
  return {
    deviceid: itemData.deviceid,
    uiid: extra.uiid,
    productModel: extra.model || '',
    brandName: (itemData.brandInfo && itemData.brandInfo.name) || '',
    name: itemData.name || '',
    online: Boolean(itemData.online),
    ip: (itemData.params && itemData.params.ip) || '',
    params: itemData.params || {},
  };
}

/**
 * @description Minimal eWeLink v2 API client (HTTP for login/discovery/polling, WebSocket for
 * device control), used as a drop-in replacement for the abandoned `ewelink-api` npm package.
 * @param {object} [options] - Connection options.
 * @param {string} [options.email] - Account email, for login.
 * @param {string} [options.password] - Account password, for login.
 * @param {string} [options.at] - Access token, once logged in.
 * @param {string} [options.apiKey] - API key, once logged in.
 * @param {string} [options.region] - Known region ('eu', 'us', 'as' or 'cn').
 * @example
 * const client = new EWeLinkClient({ email, password });
 */
class EWeLinkClient {
  constructor(options = {}) {
    this.email = options.email;
    this.password = options.password;
    this.at = options.at;
    this.apiKey = options.apiKey;
    this.region = options.region;
    this.host = REGION_HOSTS[options.region] || DEFAULT_HOST;
  }

  /**
   * @description Discover the account's region by attempting a login and reading the
   * "wrong region" redirect the API returns.
   * @returns {Promise<object>} `{ region }` on success, `{ error, msg }` on failure.
   * @example
   * await client.getRegion();
   */
  async getRegion() {
    const body = { email: this.email, password: this.password, countryCode: '+1' };
    try {
      const response = await fetch(`https://${DEFAULT_HOST}/v2/user/login`, {
        method: 'POST',
        headers: Object.assign(buildHeaders(), { Authorization: `Sign ${sign(body)}` }),
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (json.error === 10004 && json.data && json.data.region) {
        return { region: json.data.region };
      }
      if (json.data && json.data.at) {
        // Already the right (default) region.
        return { region: 'eu' };
      }
      return { error: json.error || response.status, msg: json.msg || 'eWeLink: could not determine region' };
    } catch (e) {
      return { error: 500, msg: e.message };
    }
  }

  /**
   * @description Log in and retrieve an access token + API key.
   * @returns {Promise<object>} `{ at, user: { apikey } }` on success, `{ error, msg }` on failure.
   * @example
   * await client.getCredentials();
   */
  async getCredentials() {
    const body = { email: this.email, password: this.password, countryCode: '+1' };
    try {
      const response = await fetch(`https://${this.host}/v2/user/login`, {
        method: 'POST',
        headers: Object.assign(buildHeaders(), { Authorization: `Sign ${sign(body)}` }),
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (json.data && json.data.at) {
        return { at: json.data.at, user: { apikey: json.data.user.apikey } };
      }
      return { error: json.error || response.status, msg: json.msg || 'eWeLink: login failed' };
    } catch (e) {
      return { error: 500, msg: e.message };
    }
  }

  /**
   * @description Fetch the account's home (family) ids, needed to list devices.
   * @returns {Promise<string[]>} List of family ids.
   * @example
   * await client.getHomeIds();
   */
  async getHomeIds() {
    const response = await fetch(`https://${this.host}/v2/family`, {
      headers: buildHeaders(this.at),
    });
    const json = await response.json();
    if (!json.data || !Array.isArray(json.data.familyList)) {
      return { error: json.error || response.status, msg: json.msg || 'eWeLink: could not fetch homes' };
    }
    return json.data.familyList.map((home) => home.id);
  }

  /**
   * @description List all devices across all of the account's homes, flattened into the shape
   * the rest of the eWeLink service expects. Result is cached briefly so getDevice/
   * getDeviceChannelCount don't each trigger a full re-fetch.
   * @returns {Promise<Array<object>|object>} Array of flat devices, or `{ error, msg }`.
   * @example
   * await client.getDevices();
   */
  async getDevices() {
    try {
      const homeIds = await this.getHomeIds();
      if (homeIds.error) {
        return homeIds;
      }
      const devices = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const familyId of homeIds) {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(
          `https://${this.host}/v2/device/thing?num=0&familyid=${encodeURIComponent(familyId)}`,
          { headers: buildHeaders(this.at) },
        );
        // eslint-disable-next-line no-await-in-loop
        const json = await response.json();
        if (!json.data || !Array.isArray(json.data.thingList)) {
          continue; // eslint-disable-line no-continue
        }
        json.data.thingList.forEach((item) => {
          if (item.itemData && item.itemData.extra && item.itemData.extra.uiid) {
            devices.push(flattenDevice(item.itemData));
          }
        });
      }
      this._devicesCache = devices;
      this._devicesCacheAt = Date.now();
      return devices;
    } catch (e) {
      return { error: 500, msg: e.message };
    }
  }

  /**
   * @description Get the cached device list, refreshing it if older than 5 seconds.
   * @returns {Promise<Array<object>|object>} Array of flat devices, or `{ error, msg }`.
   * @example
   * await client.getCachedDevices();
   */
  async getCachedDevices() {
    if (this._devicesCache && Date.now() - this._devicesCacheAt < 5000) {
      return this._devicesCache;
    }
    return this.getDevices();
  }

  /**
   * @description Get a single device by id.
   * @param {string} deviceId - eWeLink device id.
   * @returns {Promise<object>} Flat device object, or `{ error, msg }` if not found.
   * @example
   * await client.getDevice('1000abcd');
   */
  async getDevice(deviceId) {
    const devices = await this.getCachedDevices();
    if (devices.error) {
      return devices;
    }
    const device = devices.find((d) => d.deviceid === deviceId);
    if (!device) {
      return { error: 404, msg: `eWeLink: device "${deviceId}" not found` };
    }
    return device;
  }

  /**
   * @description Get the number of switch channels a device has.
   * @param {string} deviceId - eWeLink device id.
   * @returns {Promise<{switchesAmount: number}>} Channel count.
   * @example
   * await client.getDeviceChannelCount('1000abcd');
   */
  async getDeviceChannelCount(deviceId) {
    const device = await this.getDevice(deviceId);
    if (device.error) {
      return { switchesAmount: 0 };
    }
    if (Array.isArray(device.params.switches)) {
      return { switchesAmount: device.params.switches.length };
    }
    if (device.params.switch !== undefined) {
      return { switchesAmount: 1 };
    }
    return { switchesAmount: 0 };
  }

  /**
   * @description Get the WebSocket dispatch host used for real-time device control.
   * @returns {Promise<string>} Dispatch host.
   * @example
   * await client.getDispatchHost();
   */
  async getDispatchHost() {
    const body = { appid: APP_ID, nonce: crypto.randomBytes(4).toString('hex'), ts: Math.floor(Date.now() / 1000), version: 8 };
    const response = await fetch(`https://${this.host.replace('-apia', '-dispa')}/dispatch/app`, {
      method: 'POST',
      headers: buildHeaders(this.at),
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!json.domain) {
      throw new Error('eWeLink: could not get WebSocket dispatch host');
    }
    return json.domain;
  }

  /**
   * @description Turn a device's switch(es) on/off via the eWeLink real-time WebSocket API.
   * A short-lived connection is opened, authenticated, used to send one update, then closed.
   * @param {string} deviceId - eWeLink device id.
   * @param {string} state - 'on' or 'off'.
   * @param {number} [channel] - 1-based channel index for multi-channel devices (0 = single).
   * @param {number} [uiid] - eWeLink device uiid, used for model-specific quirks.
   * @returns {Promise<object>} `{}` on success, `{ error, msg }` on failure.
   * @example
   * await client.setDevicePowerState('1000abcd', 'on', 0);
   */
  async setDevicePowerState(deviceId, state, channel = 0, uiid = null) {
    let params;
    if (channel > 0) {
      params = { switches: [{ switch: state, outlet: channel - 1 }] };
      // POWR3 (uiid 190/276): single switch reported over multi-channel firmware,
      // the relay side must be selected explicitly or the update is ignored.
      if ([190, 276].includes(uiid)) {
        params.operSide = 1;
      }
    } else {
      params = { switch: state };
    }

    try {
      const dispatchHost = await this.getDispatchHost();
      logger.info(`eWeLink: setDevicePowerState "${deviceId}", dispatch host = "${dispatchHost}"`);
      return await new Promise((resolve) => {
        const ws = new WebSocket(`wss://${dispatchHost}:8080/api/ws`);
        let settled = false;
        const finish = (result) => {
          if (settled) {
            return;
          }
          settled = true;
          logger.info(`eWeLink: setDevicePowerState "${deviceId}", result = ${JSON.stringify(result)}`);
          try {
            ws.close();
          } catch (e) {
            // ignore
          }
          resolve(result);
        };
        const timeout = setTimeout(() => finish({ error: 504, msg: 'eWeLink: WebSocket timeout' }), 15000);

        let loggedIn = false;
        ws.on('open', () => {
          logger.info(`eWeLink: setDevicePowerState "${deviceId}", WebSocket open, sending login`);
          const sequence = String(Date.now());
          ws.send(
            JSON.stringify({
              action: 'userOnline',
              apikey: this.apiKey,
              appid: APP_ID,
              at: this.at,
              nonce: crypto.randomBytes(4).toString('hex'),
              sequence,
              ts: Math.floor(Date.now() / 1000),
              userAgent: 'app',
              version: 8,
            }),
          );
        });
        ws.on('message', (raw) => {
          logger.info(`eWeLink: setDevicePowerState "${deviceId}", WebSocket message received: ${raw}`);
          if (raw === 'pong') {
            return;
          }
          let message;
          try {
            message = JSON.parse(raw);
          } catch (e) {
            return;
          }
          if (!loggedIn) {
            if (message.error === 0 || message.config) {
              loggedIn = true;
              ws.send(
                JSON.stringify({
                  action: 'update',
                  apikey: this.apiKey,
                  deviceid: deviceId,
                  params,
                  sequence: String(Date.now()),
                  ts: 0,
                  userAgent: 'app',
                }),
              );
            } else {
              clearTimeout(timeout);
              finish({ error: message.error || 500, msg: 'eWeLink: WebSocket login failed' });
            }
            return;
          }
          clearTimeout(timeout);
          if (message.error === 0 || message.error === undefined) {
            finish({});
          } else {
            finish({ error: message.error, msg: message.reason || 'eWeLink: device update failed' });
          }
        });
        ws.on('error', (e) => {
          logger.warn(`eWeLink: setDevicePowerState "${deviceId}", WebSocket error: ${e.message}`);
          clearTimeout(timeout);
          finish({ error: 500, msg: e.message });
        });
        ws.on('close', (code, reason) => {
          logger.info(
            `eWeLink: setDevicePowerState "${deviceId}", WebSocket closed, code: ${code}, reason: ${reason}`,
          );
        });
      });
    } catch (e) {
      logger.warn(`eWeLink: setDevicePowerState failed: ${e.message}`);
      return { error: 500, msg: e.message };
    }
  }
}

module.exports = EWeLinkClient;
