const {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} = require('../../../../utils/constants');
const logger = require('../../../../utils/logger');
const { parseExternalId } = require('../utils/externalId');

// eWeLink uiid 190/276 (POWR3) report power/voltage/current as integers scaled by 100
const POWR3_DIVISOR = 100;

module.exports = {
  // Gladys feature
  generateFeature: (name) => {
    return {
      name: `${name} Voltage`,
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE,
      read_only: true,
      has_feedback: false,
      min: 0,
      max: 500,
      unit: DEVICE_FEATURE_UNITS.VOLT,
    };
  },
  pollVoltage: (eWeLinkDevice, feature) => {
    const { deviceId } = parseExternalId(feature.external_id);
    const currentVoltage =
      (eWeLinkDevice.params && Number.parseFloat(eWeLinkDevice.params.voltage) / POWR3_DIVISOR) || false;
    // if the value is different from the value we have, save new state
    if (currentVoltage && feature.last_value !== currentVoltage) {
      logger.debug(`eWeLink: Polling device "${deviceId}", voltage new value = ${currentVoltage}`);
      return currentVoltage;
    }
    return null;
  },
};
