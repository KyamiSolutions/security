import { Component } from 'preact';
import { Text } from 'preact-i18n';
import { connect } from 'unistore/preact';
import dayjs from 'dayjs';

function priceColor(price, min, max) {
  if (max === min) {
    return '#00b894';
  }
  const ratio = (price - min) / (max - min);
  if (ratio < 0.33) {
    return '#00b894';
  }
  if (ratio < 0.66) {
    return '#fdcb6e';
  }
  return '#d63031';
}

const EleringBox = ({ currentPrice, upcomingHours, cheapestHour, loading, error, language }) => (
  <div class="card">
    <div class="card-header">
      <h3 class="card-title">
        <i class="fe fe-zap" />
        <span class="m-1">
          <Text id="dashboard.boxes.elering.title" />
        </span>
      </h3>
    </div>
    <div class="card-body">
      <div class={`dimmer ${loading ? 'active' : ''}`}>
        <div class="loader" />
        {error && (
          <p class="alert alert-danger">
            <i class="fe fe-bell" />
            <span class="pl-2">
              <Text id="dashboard.boxes.elering.error" />
            </span>
          </p>
        )}
        {!error && (
          <div class="dimmer-content" style={{ minHeight: '200px' }}>
            {currentPrice && (
              <div class="text-center mb-3">
                <div style={{ fontSize: '32px', fontWeight: 'bold', color: currentPrice.color }}>
                  {currentPrice.price_cents_kwh.toFixed(2)} s/kWh
                </div>
                <div class="text-muted small">
                  <Text id="dashboard.boxes.elering.currentPrice" />
                </div>
              </div>
            )}

            <div class="row">
              {upcomingHours &&
                upcomingHours.map(hour => (
                  <div style={{ width: '8%', margin: '0.25em 0.15%' }}>
                    <p style={{ margin: 'auto', textAlign: 'center', fontSize: '9px', color: 'grey' }}>{hour.label}</p>
                    <div
                      style={{
                        height: '30px',
                        borderRadius: '3px',
                        background: hour.color
                      }}
                    />
                  </div>
                ))}
            </div>

            {cheapestHour && (
              <div class="mt-3 text-center small">
                <i class="fe fe-arrow-down text-success mr-1" />
                <Text id="dashboard.boxes.elering.cheapestHour" />: {cheapestHour.label} —{' '}
                {cheapestHour.price_cents_kwh.toFixed(2)} s/kWh
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
);

class Elering extends Component {
  refreshData = async () => {
    try {
      this.setState({ error: false, loading: true });
      const data = await this.props.httpClient.get('/api/v1/service/elering/prices');
      const prices = [...(data.prices || [])].sort((a, b) => a.timestamp - b.timestamp);
      const now = Math.floor(Date.now() / 1000);
      // Find the currently active price period (periods used to be hourly, are 15 minutes since
      // 2025 - this doesn't assume either), then show it plus the next few upcoming ones.
      let currentIndex = -1;
      prices.forEach((p, index) => {
        if (p.timestamp <= now) {
          currentIndex = index;
        }
      });
      const upcoming = (currentIndex >= 0 ? prices.slice(currentIndex) : prices).slice(0, 12);

      const relevantPrices = upcoming.length > 0 ? upcoming : prices;
      const min = Math.min(...relevantPrices.map(p => p.price_cents_kwh));
      const max = Math.max(...relevantPrices.map(p => p.price_cents_kwh));

      const upcomingHours = upcoming.map(p => ({
        label: dayjs.unix(p.timestamp).format('HH:mm'),
        price_cents_kwh: p.price_cents_kwh,
        color: priceColor(p.price_cents_kwh, min, max)
      }));

      let cheapestHour = null;
      upcoming.forEach(p => {
        if (!cheapestHour || p.price_cents_kwh < cheapestHour.price_cents_kwh) {
          cheapestHour = { label: dayjs.unix(p.timestamp).format('HH:mm'), price_cents_kwh: p.price_cents_kwh };
        }
      });

      const currentPrice = data.currentPrice
        ? {
            price_cents_kwh: data.currentPrice.price_cents_kwh,
            color: priceColor(data.currentPrice.price_cents_kwh, min, max)
          }
        : null;

      this.setState({ currentPrice, upcomingHours, cheapestHour, error: false, loading: false });
    } catch (e) {
      this.setState({ error: true, loading: false });
    }
  };

  componentDidMount() {
    this.refreshData();
    this.refreshInterval = setInterval(this.refreshData, 15 * 60 * 1000);
  }

  componentWillUnmount() {
    clearInterval(this.refreshInterval);
  }

  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      error: false
    };
  }

  render({}, { currentPrice, upcomingHours, cheapestHour, loading, error }) {
    return (
      <EleringBox
        currentPrice={currentPrice}
        upcomingHours={upcomingHours}
        cheapestHour={cheapestHour}
        loading={loading}
        error={error}
      />
    );
  }
}

export default connect('httpClient,user', {})(Elering);
