const asyncMiddleware = require('../../../api/middlewares/asyncMiddleware');

module.exports = function EleringController({ getPrices, getCurrentPrice }) {
  /**
   * @api {get} /api/v1/service/elering/prices Get Estonian day-ahead electricity prices
   * @apiName getPrices
   * @apiGroup Elering
   */
  async function getPricesController(req, res) {
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 2);

    const prices = await getPrices(start, end);
    const currentPrice = await getCurrentPrice();
    res.json({ prices, currentPrice });
  }

  return {
    'get /api/v1/service/elering/prices': {
      authenticated: true,
      controller: asyncMiddleware(getPricesController),
    },
  };
};
