import update from 'immutability-helper';
import { RequestStatus } from '../../../../utils/consts';

const STORAGE_KEY = 'kyamiMotionSources';

function loadSourcesFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSourcesToStorage(sources) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sources.map(s => s.source)));
}

function createActions(store) {
  const actions = {
    getSources(state) {
      const sources = loadSourcesFromStorage().map(source => ({
        source,
        active: false,
        snapshot: null
      }));
      store.setState({ kyamiSources: sources });
    },
    updateProbeField(state, field, value) {
      store.setState({
        kyamiProbeForm: Object.assign({}, state.kyamiProbeForm, { [field]: value })
      });
    },
    updateManualSource(state, value) {
      store.setState({ kyamiManualSource: value });
    },
    addManualSource(state) {
      const value = state.kyamiManualSource && state.kyamiManualSource.trim();
      if (!value) {
        return;
      }
      const kyamiSources = update(state.kyamiSources || [], {
        $push: [{ source: value, active: false, snapshot: null }]
      });
      saveSourcesToStorage(kyamiSources);
      store.setState({ kyamiSources, kyamiManualSource: '' });
    },
    async probeCamera(state) {
      const form = state.kyamiProbeForm || {};
      store.setState({ kyamiProbeStatus: RequestStatus.Getting, kyamiProbeError: null });
      try {
        const result = await state.httpClient.get('/api/v1/service/kyami-motion/probe', {
          ip: form.ip,
          user: form.user || 'admin',
          password: form.password || 'admin',
          port: form.port || 554
        });
        const kyamiSources = update(state.kyamiSources || [], {
          $push: [{ source: result.internal_source, active: false, snapshot: null }]
        });
        saveSourcesToStorage(kyamiSources);
        store.setState({ kyamiSources, kyamiProbeStatus: RequestStatus.Success });
      } catch (e) {
        store.setState({
          kyamiProbeStatus: RequestStatus.Error,
          kyamiProbeError: (e.response && e.response.data && e.response.data.message) || e.message
        });
      }
    },
    removeSource(state, index) {
      const kyamiSources = update(state.kyamiSources, { $splice: [[index, 1]] });
      saveSourcesToStorage(kyamiSources);
      store.setState({ kyamiSources });
    },
    async startMotion(state, index) {
      const camera = state.kyamiSources[index];
      await state.httpClient.post('/api/v1/service/kyami-motion/motion/start', { source: camera.source });
      const kyamiSources = update(state.kyamiSources, { [index]: { active: { $set: true } } });
      store.setState({ kyamiSources });
    },
    async stopMotion(state, index) {
      const camera = state.kyamiSources[index];
      await state.httpClient.post('/api/v1/service/kyami-motion/motion/stop', { source: camera.source });
      const kyamiSources = update(state.kyamiSources, { [index]: { active: { $set: false } } });
      store.setState({ kyamiSources });
    },
    async refreshSnapshot(state, index) {
      const camera = state.kyamiSources[index];
      try {
        const result = await state.httpClient.get('/api/v1/service/kyami-motion/snapshot', {
          source: camera.source
        });
        const kyamiSources = update(state.kyamiSources, { [index]: { snapshot: { $set: result.image } } });
        store.setState({ kyamiSources });
      } catch (e) {
        // camera might be offline, ignore
      }
    },
    async getRecordings(state) {
      store.setState({ kyamiGetRecordingsStatus: RequestStatus.Getting });
      try {
        const kyamiRecordings = await state.httpClient.get('/api/v1/service/kyami-motion/recordings');
        store.setState({ kyamiRecordings, kyamiGetRecordingsStatus: RequestStatus.Success });
      } catch (e) {
        store.setState({ kyamiGetRecordingsStatus: RequestStatus.Error });
      }
    },
    async deleteRecording(state, filename) {
      await state.httpClient.delete(`/api/v1/service/kyami-motion/recordings/${encodeURIComponent(filename)}`);
      await actions.getRecordings(store.getState());
    }
  };
  return actions;
}

export default createActions;
