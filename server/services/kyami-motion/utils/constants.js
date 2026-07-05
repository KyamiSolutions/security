// RTSP paths tried in order when auto-discovering a camera's stream, most common brands first.
const RTSP_PATHS = [
  '/h264Preview_01_main', // Reolink main stream (H.264)
  '/h265Preview_01_main', // Reolink main stream (H.265)
  '/h264Preview_01_sub', // Reolink sub stream
  '/11', // CamHi / Zhongxin main stream
  '/12', // CamHi sub stream
  '/stream',
  '/live/ch00_0',
  '/ch0_0.264',
  '/videoMain',
  '/cam/realmonitor?channel=1&subtype=0', // Dahua
  '/h264/ch1/main/av_stream', // Hikvision
];

const MOTION_DETECTION = {
  RECORD_SECONDS: 30,
  COOLDOWN_SECONDS: 10,
  THRESHOLD: 8000,
  SNAPSHOT_INTERVAL_MS: 125, // ~8 fps
};

module.exports = {
  RTSP_PATHS,
  MOTION_DETECTION,
};
