import { Component } from 'preact';
import { connect } from 'unistore/preact';
import actions from './actions';
import KyamiMotionPage from './KyamiMotion';

class KyamiMotionIntegration extends Component {
  componentWillMount() {
    this.props.getSources();
    this.props.getRecordings();
    this.props.getConfig();
  }

  render(props) {
    return <KyamiMotionPage {...props} />;
  }
}

export default connect(
  'session,kyamiSources,kyamiManualSource,kyamiProbeForm,kyamiProbeStatus,kyamiProbeError,kyamiRecordings,kyamiGetRecordingsStatus,kyamiDiscordWebhookUrl,kyamiConfigSaveStatus',
  actions
)(KyamiMotionIntegration);
