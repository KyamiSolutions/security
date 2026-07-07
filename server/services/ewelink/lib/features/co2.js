const {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} = require('../../../../utils/constants');
const logger = require('../../../../utils/logger');
const { parseExternalId } = require('../utils/externalId');

module.exports = {
  // Gladys feature
  generateFeature: (name) => {
    return {
      name: `${name} CO2`,
      category: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      read_only: true,
      has_feedback: false,
      min: 0,
      max: 5000,
      unit: DEVICE_FEATURE_UNITS.PPM,
    };
  },
  pollCo2: (eWeLinkDevice, feature) => {
    const { deviceId } = parseExternalId(feature.external_id);
    const currentCo2 = (eWeLinkDevice.params && Number.parseInt(eWeLinkDevice.params.co2, 10)) || false;
    // if the value is different from the value we have, save new state
    if (currentCo2 && feature.last_value !== currentCo2) {
      logger.debug(`eWeLink: Polling device "${deviceId}", co2 new value = ${currentCo2}`);
      return currentCo2;
    }
    return null;
  },
};
