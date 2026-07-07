const fs = require('fs');
const path = require('path');

const logger = require('../../../utils/logger');
const { Error400, Error404 } = require('../../../utils/httpErrors');
const asyncMiddleware = require('../../../api/middlewares/asyncMiddleware');

/**
 * @description Parse a camera source coming from the request (RTSP URL string, or USB index).
 * @param {string} rawSource - The raw source value from the request.
 * @returns {string|number} The parsed source.
 * @example
 * const source = parseSource('0');
 */
function parseSource(rawSource) {
  if (/^\d+$/.test(rawSource)) {
    return Number(rawSource);
  }
  return rawSource;
}

module.exports = function KyamiMotionController(gladys, kyamiMotionHandler) {
  /**
   * @api {get} /api/v1/service/kyami-motion/config Get kyami-motion settings
   * @apiName GetConfig
   * @apiGroup KyamiMotion
   */
  async function getConfig(req, res) {
    const config = await kyamiMotionHandler.getConfig();
    res.json(config);
  }

  /**
   * @api {post} /api/v1/service/kyami-motion/config Save kyami-motion settings
   * @apiName SaveConfig
   * @apiGroup KyamiMotion
   */
  async function saveConfig(req, res) {
    const { discordWebhookUrl } = req.body;
    const config = await kyamiMotionHandler.saveConfig({ discordWebhookUrl });
    res.json(config);
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/sources Get saved camera sources
   * @apiName GetSources
   * @apiGroup KyamiMotion
   */
  async function getSources(req, res) {
    const config = await kyamiMotionHandler.getConfig();
    res.json({ sources: config.sources || [] });
  }

  /**
   * @api {post} /api/v1/service/kyami-motion/sources Save camera sources
   * @apiName SaveSources
   * @apiGroup KyamiMotion
   */
  async function saveSources(req, res) {
    const { sources } = req.body;
    if (!Array.isArray(sources)) {
      throw new Error400('SOURCES_MUST_BE_AN_ARRAY');
    }
    const config = await kyamiMotionHandler.saveConfig({ sources });
    res.json({ sources: config.sources });
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/probe Probe a camera IP for a working RTSP path
   * @apiName Probe
   * @apiGroup KyamiMotion
   */
  async function probe(req, res) {
    const { ip, user = 'admin', password = 'admin', port = 554 } = req.query;
    if (!ip) {
      throw new Error400('IP_REQUIRED');
    }
    const url = await kyamiMotionHandler.probeRtsp(ip, user, password, Number(port));
    if (!url) {
      throw new Error404('RTSP_PATH_NOT_FOUND');
    }
    const safeUrl = url.replace(`:${encodeURIComponent(password)}@`, ':***@');
    res.json({ url: safeUrl, internal_source: url });
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/usb-cameras List USB cameras
   * @apiName ListUsbCameras
   * @apiGroup KyamiMotion
   */
  async function listUsbCameras(req, res) {
    const cameras = await kyamiMotionHandler.listUsbCameras();
    res.json(cameras);
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/usb-cameras/:index/controls Get v4l2 controls
   * @apiName GetV4l2Controls
   * @apiGroup KyamiMotion
   */
  async function getV4l2Controls(req, res) {
    const controls = await kyamiMotionHandler.getV4l2Controls(Number(req.params.index));
    res.json(controls);
  }

  /**
   * @api {post} /api/v1/service/kyami-motion/usb-cameras/:index/controls Set a v4l2 control
   * @apiName SetV4l2Control
   * @apiGroup KyamiMotion
   */
  async function setV4l2Control(req, res) {
    const { control, value } = req.body;
    if (!control || value === undefined) {
      throw new Error400('CONTROL_AND_VALUE_REQUIRED');
    }
    await kyamiMotionHandler.setV4l2Control(Number(req.params.index), control, Number(value));
    res.json({ success: true });
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/snapshot Get a single JPEG frame
   * @apiName Snapshot
   * @apiGroup KyamiMotion
   */
  async function snapshot(req, res) {
    const source = parseSource(req.query.source);
    const frame = await kyamiMotionHandler.getSnapshot(source);
    res.json({ image: `image/jpeg;base64,${frame.toString('base64')}` });
  }

  /**
   * @api {post} /api/v1/service/kyami-motion/motion/start Start motion detection
   * @apiName StartMotionDetection
   * @apiGroup KyamiMotion
   */
  async function startMotion(req, res) {
    if (!req.body || !req.body.source) {
      throw new Error400('SOURCE_REQUIRED');
    }
    const source = parseSource(req.body.source);
    const threshold = req.body.threshold ? Number(req.body.threshold) : undefined;
    kyamiMotionHandler.startMotionDetector(source, threshold);
    res.json({ success: true });
  }

  /**
   * @api {post} /api/v1/service/kyami-motion/motion/stop Stop motion detection
   * @apiName StopMotionDetection
   * @apiGroup KyamiMotion
   */
  async function stopMotion(req, res) {
    if (!req.body || !req.body.source) {
      throw new Error400('SOURCE_REQUIRED');
    }
    const source = parseSource(req.body.source);
    kyamiMotionHandler.stopMotionDetector(source);
    res.json({ success: true });
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/recordings List motion recordings
   * @apiName ListRecordings
   * @apiGroup KyamiMotion
   */
  async function listRecordings(req, res) {
    const recordings = await kyamiMotionHandler.listRecordings();
    res.json(recordings);
  }

  /**
   * @api {get} /api/v1/service/kyami-motion/recordings/:filename Download a recording
   * @apiName DownloadRecording
   * @apiGroup KyamiMotion
   */
  async function downloadRecording(req, res) {
    if (path.basename(req.params.filename) !== req.params.filename) {
      throw new Error404('RECORDING_NOT_FOUND');
    }
    const filePath = path.join(gladys.config.recordingsFolder, req.params.filename);
    const filestream = fs.createReadStream(filePath);
    filestream.on('error', () => {
      res.status(404).end();
    });
    res.set('Content-Type', 'video/mp4');
    filestream.pipe(res);
  }

  /**
   * @api {delete} /api/v1/service/kyami-motion/recordings/:filename Delete a recording
   * @apiName DeleteRecording
   * @apiGroup KyamiMotion
   */
  async function deleteRecording(req, res) {
    await kyamiMotionHandler.deleteRecording(req.params.filename);
    res.json({ success: true });
  }

  return {
    'get /api/v1/service/kyami-motion/config': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(getConfig),
    },
    'post /api/v1/service/kyami-motion/config': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(saveConfig),
    },
    'get /api/v1/service/kyami-motion/sources': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(getSources),
    },
    'post /api/v1/service/kyami-motion/sources': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(saveSources),
    },
    'get /api/v1/service/kyami-motion/probe': {
      authenticated: true,
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(probe),
    },
    'get /api/v1/service/kyami-motion/usb-cameras': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(listUsbCameras),
    },
    'get /api/v1/service/kyami-motion/usb-cameras/:index/controls': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(getV4l2Controls),
    },
    'post /api/v1/service/kyami-motion/usb-cameras/:index/controls': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(setV4l2Control),
    },
    'get /api/v1/service/kyami-motion/snapshot': {
      authenticated: true,
      admin: false,
      controller: asyncMiddleware(snapshot),
    },
    'post /api/v1/service/kyami-motion/motion/start': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(startMotion),
    },
    'post /api/v1/service/kyami-motion/motion/stop': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(stopMotion),
    },
    'get /api/v1/service/kyami-motion/recordings': {
      authenticated: true,
      admin: false,
      controller: asyncMiddleware(listRecordings),
    },
    'get /api/v1/service/kyami-motion/recordings/:filename': {
      authenticated: true,
      admin: false,
      controller: asyncMiddleware(downloadRecording),
    },
    'delete /api/v1/service/kyami-motion/recordings/:filename': {
      authenticated: true,
      admin: true,
      controller: asyncMiddleware(deleteRecording),
    },
  };
};
