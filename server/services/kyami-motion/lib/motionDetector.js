const jpeg = require('jpeg-js');
const pixelmatch = require('pixelmatch');

const logger = require('../../../utils/logger');
const { MOTION_DETECTION } = require('../utils/constants');

/**
 * @description Run one snapshot+diff cycle for a source's motion detector, scheduling the next
 * cycle regardless of success or failure so the loop is resilient to transient camera errors.
 * @param {string|number} source - RTSP URL or USB device index this detector watches.
 * @returns {Promise<void>} Resolves once the cycle (and its rescheduling) is done.
 * @example
 * await this._motionTick(source);
 */
async function motionTick(source) {
  const state = this.detectors[source];
  if (!state || !state.running) {
    return;
  }

  try {
    const jpegBuffer = await this.getSnapshot(source);
    const frame = jpeg.decode(jpegBuffer, { useTArray: true });
    const now = Date.now();

    if (state.prevFrame && state.prevFrame.width === frame.width && state.prevFrame.height === frame.height) {
      const diff = new Uint8Array(frame.width * frame.height * 4);
      const changedPixels = pixelmatch(state.prevFrame.data, frame.data, diff, frame.width, frame.height, {
        threshold: 0.1,
      });

      if (changedPixels > state.threshold) {
        if (!state.recording && now >= state.cooldownUntil) {
          logger.info(`kyami-motion: motion detected on ${source}, starting recording`);
          // eslint-disable-next-line no-await-in-loop
          state.recording = await this.startRecording(source, MOTION_DETECTION.RECORD_SECONDS);
          state.recordingUntil = now + MOTION_DETECTION.RECORD_SECONDS * 1000;
          this.notifyDiscord(source, jpegBuffer).catch(() => {});
        }
      }
    }

    state.prevFrame = frame;

    if (state.recording && now >= state.recordingUntil) {
      this.stopRecording(state.recording);
      state.recording = null;
      state.cooldownUntil = now + MOTION_DETECTION.COOLDOWN_SECONDS * 1000;
    }
  } catch (e) {
    logger.debug(`kyami-motion: motion detection cycle failed for ${source}: ${e.message}`);
  }

  if (state.running) {
    state.timer = setTimeout(() => {
      this.motionTick(source);
    }, MOTION_DETECTION.SNAPSHOT_INTERVAL_MS);
  }
}

/**
 * @description Start background motion detection (frame-diffing) on a camera source, recording
 * a video clip to disk whenever enough pixels change between consecutive frames.
 * @param {string|number} source - RTSP URL or USB device index.
 * @param {number} [threshold] - Number of changed pixels above which motion is considered detected.
 * @returns {void}
 * @example
 * startMotionDetector.call(this, 'rtsp://...');
 */
function startMotionDetector(source, threshold = MOTION_DETECTION.THRESHOLD) {
  if (this.detectors[source] && this.detectors[source].running) {
    return;
  }
  this.detectors[source] = {
    running: true,
    threshold,
    prevFrame: null,
    recording: null,
    recordingUntil: 0,
    cooldownUntil: 0,
    timer: null,
  };
  this.motionTick(source);
}

/**
 * @description Stop background motion detection for a camera source, and stop any in-progress
 * recording for it.
 * @param {string|number} source - RTSP URL or USB device index.
 * @returns {void}
 * @example
 * stopMotionDetector.call(this, 'rtsp://...');
 */
function stopMotionDetector(source) {
  const state = this.detectors[source];
  if (!state) {
    return;
  }
  state.running = false;
  if (state.timer) {
    clearTimeout(state.timer);
  }
  if (state.recording) {
    this.stopRecording(state.recording);
  }
  delete this.detectors[source];
}

module.exports = {
  motionTick,
  startMotionDetector,
  stopMotionDetector,
};
