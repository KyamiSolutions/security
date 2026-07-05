const fse = require('fs-extra');
const path = require('path');

const logger = require('../../../utils/logger');
const { NotFoundError } = require('../../../utils/coreErrors');

/**
 * @description Start recording a video segment from a camera source to disk.
 * @param {string|number} source - RTSP URL or USB device index.
 * @param {number} seconds - Recording duration in seconds.
 * @returns {Promise<string>} Path to the recording file being written.
 * @example
 * const filePath = await startRecording.call(this, 'rtsp://...', 30);
 */
async function startRecording(source, seconds) {
  await fse.ensureDir(this.gladys.config.recordingsFolder);
  const isRtsp = typeof source === 'string' && source.startsWith('rtsp://');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const filename = `motion_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.mp4`;
  const filePath = path.join(this.gladys.config.recordingsFolder, filename);

  const args = [];
  if (isRtsp) {
    args.push('-rtsp_transport', 'tcp', '-i', source, '-t', String(seconds), '-c', 'copy', filePath);
  } else {
    args.push('-f', 'v4l2', '-i', `/dev/video${source}`, '-t', String(seconds), '-c:v', 'libx264', filePath);
  }

  const child = this.childProcess.spawn('ffmpeg', args);
  child.on('error', (e) => {
    logger.warn(`kyami-motion: recording process error: ${e.message}`);
  });

  return { filePath, child };
}

/**
 * @description Stop an in-progress recording started by startRecording.
 * @param {object} recording - The object returned by startRecording.
 * @returns {void}
 * @example
 * stopRecording(recording);
 */
function stopRecording(recording) {
  if (recording && recording.child && !recording.child.killed) {
    recording.child.kill('SIGINT');
  }
}

/**
 * @description List all motion recordings saved to disk.
 * @returns {Promise<Array>} List of recordings with filename, size and mtime.
 * @example
 * const recordings = await listRecordings.call(this);
 */
async function listRecordings() {
  await fse.ensureDir(this.gladys.config.recordingsFolder);
  const files = await fse.readdir(this.gladys.config.recordingsFolder);
  const results = await Promise.all(
    files
      .filter((name) => name.endsWith('.mp4'))
      .map(async (name) => {
        const filePath = path.join(this.gladys.config.recordingsFolder, name);
        const stats = await fse.stat(filePath);
        return { filename: name, size: stats.size, mtime: stats.mtimeMs };
      }),
  );
  return results.sort((a, b) => b.filename.localeCompare(a.filename));
}

/**
 * @description Delete a motion recording from disk.
 * @param {string} filename - The recording's filename, as returned by listRecordings.
 * @returns {Promise<void>} Resolves once removed.
 * @example
 * await deleteRecording.call(this, 'motion_20260101_120000.mp4');
 */
async function deleteRecording(filename) {
  if (path.basename(filename) !== filename) {
    throw new NotFoundError('RECORDING_NOT_FOUND');
  }
  const filePath = path.join(this.gladys.config.recordingsFolder, filename);
  const exists = await fse.pathExists(filePath);
  if (!exists) {
    throw new NotFoundError('RECORDING_NOT_FOUND');
  }
  await fse.remove(filePath);
}

module.exports = {
  startRecording,
  stopRecording,
  listRecordings,
  deleteRecording,
};
