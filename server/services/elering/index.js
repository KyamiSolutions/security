const logger = require('../../utils/logger');
const EleringController = require('./controllers/elering.controller');

const ELERING_PRICE_API_URL = 'https://dashboard.elering.ee/api/nps/price';
const ELERING_AREA = 'ee';

/**
 * @description Convert a price in EUR/MWh (Elering's unit) to cents/kWh (easier to reason
 * about for a home electricity bill).
 * @param {number} eurPerMwh - Price in EUR/MWh.
 * @returns {number} Price in cents/kWh, rounded to 2 decimals.
 * @example
 * eurPerMwhToCentsPerKwh(45.6); // 4.56
 */
function eurPerMwhToCentsPerKwh(eurPerMwh) {
  return Math.round((eurPerMwh / 10) * 100) / 100;
}

module.exports = function EleringService(gladys) {
  /**
   * @public
   * @description This function starts the service.
   * @returns {Promise<void>} Resolves once the service is started.
   * @example
   * gladys.services.elering.start();
   */
  async function start() {
    logger.info('Starting Elering service');
  }

  /**
   * @public
   * @description This function stops the service.
   * @returns {Promise<void>} Resolves once the service is stopped.
   * @example
   * gladys.services.elering.stop();
   */
  async function stop() {
    logger.info('Stopping Elering service');
  }

  /**
   * @description Fetch Estonian day-ahead (Nord Pool) electricity prices from Elering's public
   * API, for the given time range.
   * @param {Date} start - Range start.
   * @param {Date} end - Range end.
   * @returns {Promise<Array<{timestamp: number, price_eur_mwh: number, price_cents_kwh: number}>>}
   * Hourly prices.
   * @example
   * getPrices(new Date(), new Date(Date.now() + 24 * 60 * 60 * 1000));
   */
  async function getPrices(start, end) {
    const url = `${ELERING_PRICE_API_URL}?start=${start.toISOString()}&end=${end.toISOString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Elering API returned ${response.status}`);
    }
    const body = await response.json();
    const hourlyPrices = (body.data && body.data[ELERING_AREA]) || [];
    return hourlyPrices.map((hour) => ({
      timestamp: hour.timestamp,
      price_eur_mwh: hour.price,
      price_cents_kwh: eurPerMwhToCentsPerKwh(hour.price),
    }));
  }

  /**
   * @description Get the current hour's Estonian electricity price.
   * @returns {Promise<{timestamp: number, price_eur_mwh: number, price_cents_kwh: number}|null>}
   * Current hour price, or null if not found.
   * @example
   * getCurrentPrice();
   */
  async function getCurrentPrice() {
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(now.getUTCHours() - 1, 0, 0, 0);
    const end = new Date(now);
    end.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    const prices = await getPrices(start, end);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return prices.find((hour) => nowSeconds >= hour.timestamp && nowSeconds < hour.timestamp + 3600) || null;
  }

  return Object.freeze({
    start,
    stop,
    getPrices,
    getCurrentPrice,
    controllers: EleringController({ getPrices, getCurrentPrice }),
  });
};
