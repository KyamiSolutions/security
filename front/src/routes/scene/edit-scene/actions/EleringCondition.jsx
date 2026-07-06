import { Component } from 'preact';
import { connect } from 'unistore/preact';
import { Text } from 'preact-i18n';
import get from 'get-value';

const isNullOrUndefined = variable => variable === null || variable === undefined;

class EleringCondition extends Component {
  handleComparatorChange = e => {
    this.props.updateActionProperty(this.props.path, 'elering_comparator', e.target.value);
  };

  handleThresholdChange = e => {
    this.props.updateActionProperty(this.props.path, 'elering_price_threshold', e.target.value);
  };

  initActionIfNeeded = () => {
    if (isNullOrUndefined(get(this.props, 'action.elering_comparator'))) {
      this.props.updateActionProperty(this.props.path, 'elering_comparator', 'below');
    }
    if (isNullOrUndefined(get(this.props, 'action.elering_price_threshold'))) {
      this.props.updateActionProperty(this.props.path, 'elering_price_threshold', 5);
    }
  };

  componentDidMount() {
    this.initActionIfNeeded();
  }

  render({ action }, {}) {
    return (
      <div>
        <div class="row">
          <div class="col-md-12">
            <p>
              <Text id="editScene.actionsCard.eleringCondition.description" />
            </p>
          </div>
        </div>
        <div class="row">
          <div class="col-6">
            <div class="form-group">
              <div class="form-label">
                <Text id="editScene.actionsCard.eleringCondition.comparatorLabel" />
              </div>
              <select class="form-control" onChange={this.handleComparatorChange} value={action.elering_comparator}>
                <option value="below">
                  <Text id="editScene.actionsCard.eleringCondition.below" />
                </option>
                <option value="above">
                  <Text id="editScene.actionsCard.eleringCondition.above" />
                </option>
              </select>
            </div>
          </div>
          <div class="col-6">
            <div class="form-group">
              <div class="form-label">
                <Text id="editScene.actionsCard.eleringCondition.thresholdLabel" />
              </div>
              <input
                type="number"
                step="0.1"
                class="form-control"
                value={action.elering_price_threshold}
                onInput={this.handleThresholdChange}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default connect('user,httpClient', {})(EleringCondition);
