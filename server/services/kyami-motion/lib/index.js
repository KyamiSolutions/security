const { tcpReachable } = require('./tcpReachable');
const { getSnapshot } = require('./getSnapshot');
const { probeRtsp } = require('./probeRtsp');
const { listUsbCameras } = require('./listUsbCameras');
const { getV4l2Controls, setV4l2Control } = require('./v4l2Controls');
const { startRecording, stopRecording, listRecordings, deleteRecording } = require('./recordings');
const { motionTick, startMotionDetector, stopMotionDetector } = require('./motionDetector');
const { notifyDiscord, sendTestNotification } = require('./discordNotify');
const { getConfig, saveConfig } = require('./config');

/**
 * @description Handler exposing all kyami-motion functions, bound so `this` inside each
 * function has access to `gladys` and `childProcess`.
 * @class KyamiMotionHandler
 * @example
 * const kyamiMotionHandler = new KyamiMotionHandler(gladys, childProcess);
 */
class KyamiMotionHandler {
  constructor(gladys, childProcess) {
    this.gladys = gladys;
    this.childProcess = childProcess;
    this.detectors = {};
  }
}

KyamiMotionHandler.prototype.tcpReachable = tcpReachable;
KyamiMotionHandler.prototype.getSnapshot = getSnapshot;
KyamiMotionHandler.prototype.probeRtsp = probeRtsp;
KyamiMotionHandler.prototype.listUsbCameras = listUsbCameras;
KyamiMotionHandler.prototype.getV4l2Controls = getV4l2Controls;
KyamiMotionHandler.prototype.setV4l2Control = setV4l2Control;
KyamiMotionHandler.prototype.startRecording = startRecording;
KyamiMotionHandler.prototype.stopRecording = stopRecording;
KyamiMotionHandler.prototype.listRecordings = listRecordings;
KyamiMotionHandler.prototype.deleteRecording = deleteRecording;
KyamiMotionHandler.prototype.motionTick = motionTick;
KyamiMotionHandler.prototype.startMotionDetector = startMotionDetector;
KyamiMotionHandler.prototype.stopMotionDetector = stopMotionDetector;
KyamiMotionHandler.prototype.notifyDiscord = notifyDiscord;
KyamiMotionHandler.prototype.sendTestNotification = sendTestNotification;
KyamiMotionHandler.prototype.getConfig = getConfig;
KyamiMotionHandler.prototype.saveConfig = saveConfig;

module.exports = KyamiMotionHandler;
