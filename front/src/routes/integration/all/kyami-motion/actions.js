import update from 'immutability-helper';
import { RequestStatus } from '../../../../utils/consts';

function saveSourcesToBackend(state, kyamiSources) {
  return state.httpClient.post('/api/v1/service/kyami-motion/sources', {
    sources: kyamiSources.map(s => s.source)
  });
}

function createActions(store) {
  const actions = {
    async getSources(state) {
      store.setState({ kyamiGetSourcesStatus: RequestStatus.Getting });
      try {
        const result = await state.httpClient.get('/api/v1/service/kyami-motion/sources');
        const kyamiSources = (result.sources || []).map(entry => ({
          source: entry.source,
          active: Boolean(entry.active),
          snapshot: null
        }));
        store.setState({ kyamiSources, kyamiGetSourcesStatus: RequestStatus.Success });
      } catch (e) {
        store.setState({ kyamiSources: [], kyamiGetSourcesStatus: RequestStatus.Error });
      }
    },
    updateProbeField(state, field, value) {
      store.setState({
        kyamiProbeForm: Object.assign({}, state.kyamiProbeForm, { [field]: value })
      });
    },
    updateManualSource(state, value) {
      store.setState({ kyamiManualSource: value });
    },
    async addManualSource(state) {
      const value = state.kyamiManualSource && state.kyamiManualSource.trim();
      if (!value) {
        return;
      }
      const kyamiSources = update(state.kyamiSources || [], {
        $push: [{ source: value, active: false, snapshot: null }]
      });
      await saveSourcesToBackend(state, kyamiSources);
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
        await saveSourcesToBackend(state, kyamiSources);
        store.setState({ kyamiSources, kyamiProbeStatus: RequestStatus.Success });
      } catch (e) {
        store.setState({
          kyamiProbeStatus: RequestStatus.Error,
          kyamiProbeError: (e.response && e.response.data && e.response.data.message) || e.message
        });
      }
    },
    async removeSource(state, index) {
      const kyamiSources = update(state.kyamiSources, { $splice: [[index, 1]] });
      await saveSourcesToBackend(state, kyamiSources);
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
    },
    async getConfig(state) {
      const config = await state.httpClient.get('/api/v1/service/kyami-motion/config');
      store.setState({ kyamiDiscordWebhookUrl: config.discordWebhookUrl || '' });
    },
    updateDiscordWebhookUrl(state, value) {
      store.setState({ kyamiDiscordWebhookUrl: value });
    },
    async saveConfig(state) {
      store.setState({ kyamiConfigSaveStatus: RequestStatus.Getting });
      try {
        await state.httpClient.post('/api/v1/service/kyami-motion/config', {
          discordWebhookUrl: state.kyamiDiscordWebhookUrl
        });
        store.setState({ kyamiConfigSaveStatus: RequestStatus.Success });
      } catch (e) {
        store.setState({ kyamiConfigSaveStatus: RequestStatus.Error });
      }
    },
    async sendTestNotification(state) {
      store.setState({ kyamiTestNotificationStatus: RequestStatus.Getting, kyamiTestNotificationError: null });
      try {
        const result = await state.httpClient.post('/api/v1/service/kyami-motion/notifications/test', {});
        if (result.success) {
          store.setState({ kyamiTestNotificationStatus: RequestStatus.Success });
        } else {
          store.setState({
            kyamiTestNotificationStatus: RequestStatus.Error,
            kyamiTestNotificationError: result.error
          });
        }
      } catch (e) {
        store.setState({
          kyamiTestNotificationStatus: RequestStatus.Error,
          kyamiTestNotificationError: (e.response && e.response.data && e.response.data.message) || e.message
        });
      }
    }
  };
  return actions;
}

export default createActions;
