import { Component } from 'preact';
import { Text } from 'preact-i18n';
import { connect } from 'unistore/preact';

class ChatSidebar extends Component {
  state = {
    gladysPlusConfigured: null,
    groqApiKey: '',
    geminiApiKey: '',
    chatProvider: 'auto',
    saving: false,
    saved: false
  };

  fetchStatus = async () => {
    try {
      const gatewayStatus = await this.props.httpClient.get('/api/v1/gateway/status');
      this.setState({
        gladysPlusConfigured: gatewayStatus.configured === true || gatewayStatus.aiChatAvailable === true
      });
    } catch (e) {
      console.error(e);
      this.setState({
        gladysPlusConfigured: false
      });
    }
  };

  fetchKeys = async () => {
    try {
      const groq = await this.props.httpClient.get('/api/v1/variable/GROQ_API_KEY');
      this.setState({ groqApiKey: groq.value || '' });
    } catch (e) {
      // not configured yet
    }
    try {
      const gemini = await this.props.httpClient.get('/api/v1/variable/GEMINI_API_KEY');
      this.setState({ geminiApiKey: gemini.value || '' });
    } catch (e) {
      // not configured yet
    }
    try {
      const provider = await this.props.httpClient.get('/api/v1/variable/AI_CHAT_PROVIDER');
      this.setState({ chatProvider: provider.value || 'auto' });
    } catch (e) {
      // not configured yet, keep default 'auto'
    }
  };

  updateGroqApiKey = e => {
    this.setState({ groqApiKey: e.target.value, saved: false });
  };

  updateGeminiApiKey = e => {
    this.setState({ geminiApiKey: e.target.value, saved: false });
  };

  updateChatProvider = e => {
    this.setState({ chatProvider: e.target.value, saved: false });
  };

  saveKeys = async () => {
    this.setState({ saving: true, saved: false });
    try {
      await this.props.httpClient.post('/api/v1/variable/GROQ_API_KEY', { value: this.state.groqApiKey });
      await this.props.httpClient.post('/api/v1/variable/GEMINI_API_KEY', { value: this.state.geminiApiKey });
      await this.props.httpClient.post('/api/v1/variable/AI_CHAT_PROVIDER', { value: this.state.chatProvider });
      await this.fetchStatus();
      this.setState({ saving: false, saved: true });
    } catch (e) {
      console.error(e);
      this.setState({ saving: false });
    }
  };

  componentDidMount() {
    this.fetchStatus();
    this.fetchKeys();
  }

  render({}, { gladysPlusConfigured, groqApiKey, geminiApiKey, chatProvider, saving, saved }) {
    return (
      <div>
        <div class="card mb-3">
          <div class="card-header">
            <h3 class="card-title mb-0">
              <Text id="chat.sidebar.title" />
            </h3>
          </div>
          <div class="card-body">
            <p class="text-muted small mb-3">
              <Text id="chat.sidebar.intro" />
            </p>

            {gladysPlusConfigured ? (
              <p class="small mb-3">
                <i class="fe fe-check text-success mr-1" />
                <Text id="chat.sidebar.plusActive" />
              </p>
            ) : (
              <p class="small mb-3 text-muted">
                <Text id="chat.sidebar.plusNotConfigured" />
              </p>
            )}

            <label class="form-label small mb-1">
              <Text id="chat.sidebar.groqApiKeyLabel">Groq API key (free)</Text>
            </label>
            <input
              type="password"
              class="form-control form-control-sm mb-2"
              placeholder="gsk_..."
              value={groqApiKey}
              onInput={this.updateGroqApiKey}
            />

            <label class="form-label small mb-1">
              <Text id="chat.sidebar.geminiApiKeyLabel">Gemini API key (free fallback)</Text>
            </label>
            <input
              type="password"
              class="form-control form-control-sm mb-2"
              placeholder="AIza..."
              value={geminiApiKey}
              onInput={this.updateGeminiApiKey}
            />

            <label class="form-label small mb-1">
              <Text id="chat.sidebar.chatProviderLabel">
                Text chat provider (used for text chat only; voice transcription always uses Groq)
              </Text>
            </label>
            <select class="form-control form-control-sm mb-2" value={chatProvider} onChange={this.updateChatProvider}>
              <option value="auto">
                <Text id="chat.sidebar.chatProviderAuto">Automatic (Groq, then Gemini)</Text>
              </option>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
            </select>

            <button class="btn btn-primary btn-sm" onClick={this.saveKeys} disabled={saving}>
              <Text id="chat.sidebar.saveKeys">Save</Text>
            </button>
            {saved && (
              <span class="ml-2 text-success small">
                <Text id="chat.sidebar.keysSaved">Saved!</Text>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default connect('httpClient', {})(ChatSidebar);
