const logger = require('../../utils/logger');
const EleringController = require('./controllers/elering.controller');

const ELERING_PRICE_API_URL = 'https://dashboard.elering.ee/api/nps/price';
const ELERING_AREA = 'ee';
// Estonian standard VAT rate (24% since 1 July 2025). Comparison sites like elektrihind.ee
// show the exchange price with VAT included by default, so we match that here.
const VAT_RATE = 0.24;

/**
 * @description Convert a price in EUR/MWh (Elering's unit, excluding VAT) to cents/kWh
 * including VAT, matching what a home electricity bill / elektrihind.ee shows.
 * @param {number} eurPerMwh - Price in EUR/MWh, excluding VAT.
 * @returns {number} Price in cents/kWh, including VAT, rounded to 2 decimals.
 * @example
 * eurPerMwhToCentsPerKwh(45.6); // 5.65 (incl. 24% VAT)
 */
function eurPerMwhToCentsPerKwh(eurPerMwh) {
  return Math.round(((eurPerMwh * (1 + VAT_RATE)) / 10) * 100) / 100;
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
   * @description Get the current Estonian electricity price. Elering price periods used to be
   * hourly but switched to 15-minute periods in 2025 - this doesn't assume either, it just picks
   * the latest period that has already started.
   * @returns {Promise<{timestamp: number, price_eur_mwh: number, price_cents_kwh: number}|null>}
   * Current period price, or null if not found.
   * @example
   * getCurrentPrice();
   */
  async function getCurrentPrice() {
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    const prices = await getPrices(start, end);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const started = prices.filter((price) => price.timestamp <= nowSeconds).sort((a, b) => a.timestamp - b.timestamp);
    return started.length > 0 ? started[started.length - 1] : null;
  }

  return Object.freeze({
    start,
    stop,
    getPrices,
    getCurrentPrice,
    controllers: EleringController({ getPrices, getCurrentPrice }),
  });
};
