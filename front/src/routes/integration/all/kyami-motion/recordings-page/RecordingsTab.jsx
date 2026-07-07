import { Text } from 'preact-i18n';
import { useState } from 'preact/hooks';
import { RequestStatus } from '../../../../../utils/consts';
import SecurityCameraPage from '../SecurityCameraPage';

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

function fetchRecordingBlobUrl(session, filename) {
  const url = `${window.location.origin}/api/v1/service/kyami-motion/recordings/${encodeURIComponent(filename)}`;
  return fetch(url, {
    headers: { authorization: `Bearer ${session.getAccessToken()}` }
  })
    .then(response => response.blob())
    .then(blob => window.URL.createObjectURL(blob));
}

function downloadRecording(session, filename) {
  fetchRecordingBlobUrl(session, filename).then(blobUrl => {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(blobUrl);
  });
}

const VideoPreviewModal = ({ filename, videoUrl, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.75)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
  >
    <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="text-white">{filename}</span>
        <button class="btn btn-sm btn-light" onClick={onClose}>
          <i class="fe fe-x" />
        </button>
      </div>
      {videoUrl ? (
        <video src={videoUrl} controls autoplay style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
      ) : (
        <div class="text-white">
          <Text id="integration.kyamiMotion.loading">Loading...</Text>
        </div>
      )}
    </div>
  </div>
);

const RecordingsTab = props => {
  const [preview, setPreview] = useState(null);

  function openPreview(filename) {
    setPreview({ filename, videoUrl: null });
    fetchRecordingBlobUrl(props.session, filename).then(videoUrl => {
      setPreview({ filename, videoUrl });
    });
  }

  function closePreview() {
    if (preview && preview.videoUrl) {
      window.URL.revokeObjectURL(preview.videoUrl);
    }
    setPreview(null);
  }

  return (
    <SecurityCameraPage>
      <div class="card">
        <div class="card-header">
          <h1 class="card-title">
            <Text id="integration.kyamiMotion.recordingsTitle">Motion recordings</Text>
          </h1>
          <div class="page-options d-flex">
            <button class="btn btn-outline-secondary btn-sm" onClick={props.getRecordings}>
              <i class="fe fe-refresh-cw" />
            </button>
          </div>
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
                        class="btn btn-sm btn-outline-secondary mr-2"
                        onClick={() => openPreview(recording.filename)}
                      >
                        <i class="fe fe-eye" />
                      </button>
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
      {preview && (
        <VideoPreviewModal filename={preview.filename} videoUrl={preview.videoUrl} onClose={closePreview} />
      )}
    </SecurityCameraPage>
  );
};

export default RecordingsTab;
