import { Component } from 'preact';
import { connect } from 'unistore/preact';
import actions from '../actions';
import SettingsTab from './SettingsTab';

class SettingsPage extends Component {
  componentWillMount() {
    this.props.getConfig();
  }

  render(props) {
    return <SettingsTab {...props} />;
  }
}

export default connect('kyamiDiscordWebhookUrl,kyamiConfigSaveStatus', actions)(SettingsPage);
