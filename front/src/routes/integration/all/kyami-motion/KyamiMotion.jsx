import { Text } from 'preact-i18n';
import { RequestStatus } from '../../../../utils/consts';

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function downloadRecording(session, filename) {
  const url = `${window.location.origin}/api/v1/service/kyami-motion/recordings/${encodeURIComponent(filename)}`;
  fetch(url, {
    headers: { authorization: `Bearer ${session.getAccessToken()}` }
  })
    .then(response => response.blob())
    .then(blob => {
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    });
}

const KyamiMotionPage = props => (
  <div class="page">
    <div class="page-main">
      <div class="my-3 my-md-5">
        <div class="container">
          <div class="row">
            <div class="col-lg-3">
              <h3 class="page-title mb-5">
                <Text id="integration.kyamiMotion.title">Kyami Motion</Text>
              </h3>
            </div>

            <div class="col-lg-9">
              <div class="card">
                <div class="card-header">
                  <h1 class="card-title">
                    <Text id="integration.kyamiMotion.probeTitle">Add a camera by IP (auto-discover RTSP path)</Text>
                  </h1>
                </div>
                <div class="card-body">
                  <div class="form-row">
                    <div class="col-md-3 form-group">
                      <label>IP</label>
                      <input
                        class="form-control"
                        placeholder="192.168.1.50"
                        value={props.kyamiProbeForm && props.kyamiProbeForm.ip}
                        onInput={e => props.updateProbeField('ip', e.target.value)}
                      />
                    </div>
                    <div class="col-md-3 form-group">
                      <label>User</label>
                      <input
                        class="form-control"
                        placeholder="admin"
                        value={props.kyamiProbeForm && props.kyamiProbeForm.user}
                        onInput={e => props.updateProbeField('user', e.target.value)}
                      />
                    </div>
                    <div class="col-md-3 form-group">
                      <label>Password</label>
                      <input
                        type="password"
                        class="form-control"
                        value={props.kyamiProbeForm && props.kyamiProbeForm.password}
                        onInput={e => props.updateProbeField('password', e.target.value)}
                      />
                    </div>
                    <div class="col-md-3 form-group">
                      <label>Port</label>
                      <input
                        class="form-control"
                        placeholder="554"
                        value={props.kyamiProbeForm && props.kyamiProbeForm.port}
                        onInput={e => props.updateProbeField('port', e.target.value)}
                      />
                    </div>
                  </div>
                  <button class="btn btn-primary" onClick={props.probeCamera}>
                    <Text id="integration.kyamiMotion.probeButton">Find camera</Text>
                  </button>
                  {props.kyamiProbeStatus === RequestStatus.Error && (
                    <div class="alert alert-danger mt-3">{props.kyamiProbeError}</div>
                  )}
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <h1 class="card-title">
                    <Text id="integration.kyamiMotion.addManualTitle">Or add a source manually</Text>
                  </h1>
                </div>
                <div class="card-body d-flex">
                  <input
                    class="form-control mr-2"
                    placeholder="rtsp://... or a USB index like 0"
                    value={props.kyamiManualSource}
                    onInput={e => props.updateManualSource(e.target.value)}
                  />
                  <button class="btn btn-outline-primary" onClick={props.addManualSource}>
                    <Text id="integration.kyamiMotion.addButton">Add</Text>
                  </button>
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <h1 class="card-title">
                    <Text id="integration.kyamiMotion.camerasTitle">Cameras</Text>
                  </h1>
                </div>
                <div class="card-body">
                  {(!props.kyamiSources || props.kyamiSources.length === 0) && (
                    <p class="text-muted">
                      <Text id="integration.kyamiMotion.noCameras">No camera added yet.</Text>
                    </p>
                  )}
                  <div class="row">
                    {props.kyamiSources &&
                      props.kyamiSources.map((camera, index) => (
                        <div class="col-md-4 mb-4" key={camera.source}>
                          <div class="card">
                            {camera.snapshot && (
                              <img class="card-img-top" src={`data:${camera.snapshot}`} alt={camera.source} />
                            )}
                            <div class="card-body">
                              <p class="text-truncate" title={camera.source}>
                                {camera.source}
                              </p>
                              <div class="btn-list">
                                <button class="btn btn-sm btn-secondary" onClick={() => props.refreshSnapshot(index)}>
                                  <Text id="integration.kyamiMotion.snapshotButton">Snapshot</Text>
                                </button>
                                {camera.active ? (
                                  <button class="btn btn-sm btn-danger" onClick={() => props.stopMotion(index)}>
                                    <Text id="integration.kyamiMotion.stopButton">Stop motion detection</Text>
                                  </button>
                                ) : (
                                  <button class="btn btn-sm btn-success" onClick={() => props.startMotion(index)}>
                                    <Text id="integration.kyamiMotion.startButton">Start motion detection</Text>
                                  </button>
                                )}
                                <button class="btn btn-sm btn-outline-danger" onClick={() => props.removeSource(index)}>
                                  <i class="fe fe-trash-2" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div class="card">
                <div class="card-header">
                  <h1 class="card-title">
                    <Text id="integration.kyamiMotion.recordingsTitle">Motion recordings</Text>
                  </h1>
                </div>
                <div class="card-body">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>
                          <Text id="integration.kyamiMotion.filename">File</Text>
                        </th>
                        <th>
                          <Text id="integration.kyamiMotion.size">Size</Text>
                        </th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {props.kyamiRecordings &&
                        props.kyamiRecordings.map(recording => (
                          <tr key={recording.filename}>
                            <td>{recording.filename}</td>
                            <td>{formatBytes(recording.size)}</td>
                            <td class="text-right">
                              <button
                                class="btn btn-sm btn-outline-primary mr-2"
                                onClick={() => downloadRecording(props.session, recording.filename)}
                              >
                                <i class="fe fe-download" />
                              </button>
                              <button
                                class="btn btn-sm btn-outline-danger"
                                onClick={() => props.deleteRecording(recording.filename)}
                              >
                                <i class="fe fe-trash-2" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {(!props.kyamiRecordings || props.kyamiRecordings.length === 0) && (
                    <p class="text-muted">
                      <Text id="integration.kyamiMotion.noRecordings">No recordings yet.</Text>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default KyamiMotionPage;
