import { Text } from 'preact-i18n';
import { RequestStatus } from '../../../../../utils/consts';
import SecurityCameraPage from '../SecurityCameraPage';

const SettingsTab = props => (
  <SecurityCameraPage>
    <div class="card">
      <div class="card-header">
        <h1 class="card-title">
          <Text id="integration.kyamiMotion.notificationsTitle">Discord notifications</Text>
        </h1>
      </div>
      <div class="card-body d-flex">
        <input
          class="form-control mr-2"
          placeholder="https://discord.com/api/webhooks/..."
          value={props.kyamiDiscordWebhookUrl}
          onInput={e => props.updateDiscordWebhookUrl(e.target.value)}
        />
        <button class="btn btn-outline-primary" onClick={props.saveConfig}>
          <Text id="integration.kyamiMotion.saveButton">Save</Text>
        </button>
        {props.kyamiConfigSaveStatus === RequestStatus.Success && (
          <span class="ml-2 text-success align-self-center">
            <Text id="integration.kyamiMotion.saved">Saved!</Text>
          </span>
        )}
      </div>
    </div>
  </SecurityCameraPage>
);

export default SettingsTab;
