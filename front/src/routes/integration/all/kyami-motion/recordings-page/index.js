import { Component } from 'preact';
import { connect } from 'unistore/preact';
import actions from '../actions';
import RecordingsTab from './RecordingsTab';

class RecordingsPage extends Component {
  componentWillMount() {
    this.props.getRecordings();
  }

  render(props) {
    return <RecordingsTab {...props} />;
  }
}

export default connect('session,kyamiRecordings,kyamiGetRecordingsStatus', actions)(RecordingsPage);
