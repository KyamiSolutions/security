import { Component } from 'preact';
import { connect } from 'unistore/preact';
import actions from '../actions';
import CamerasTab from './CamerasTab';

class CamerasPage extends Component {
  componentWillMount() {
    this.props.getSources();
  }

  render(props) {
    return <CamerasTab {...props} />;
  }
}

export default connect(
  'session,kyamiSources,kyamiGetSourcesStatus,kyamiManualSource,kyamiProbeForm,kyamiProbeStatus,kyamiProbeError',
  actions
)(CamerasPage);
