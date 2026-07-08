import { Component } from 'preact';
import { connect } from 'unistore/preact';
import { Text, Localizer } from 'preact-i18n';
import leaflet from 'leaflet';

const icon = leaflet.icon({
  iconUrl: '/assets/leaflet/marker-icon.png',
  iconRetinaUrl: '/assets/leaflet/marker-icon-2x.png',
  shadowUrl: '/assets/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

const DEFAULT_COORDS = [48.8583, 2.2945];

class MapComponent extends Component {
  initMap = () => {
    if (this.leafletMap) {
      this.leafletMap.remove();
      this.houseMarker = null;
    }
    let coordinates;
    if (this.props.house.latitude && this.props.house.longitude) {
      coordinates = [this.props.house.latitude, this.props.house.longitude];
    } else {
      coordinates = DEFAULT_COORDS;
    }
    this.leafletMap = leaflet.map(this.map).setView(coordinates, 2);

    // Use the global dark mode state from props
    const isDarkMode = this.props.darkMode;

    // Use dark tiles if dark mode is active, otherwise use light tiles
    // Force new tile layer by adding timestamp to URL to prevent caching
    const tileStyle = isDarkMode ? 'dark_all' : 'light_all';
    const timestamp = new Date().getTime();

    const tileUrl = `https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}.png?_=${timestamp}`;

    leaflet
      .tileLayer(tileUrl, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://cartodb.com/attributions">CartoDB</a>',
        subdomains: 'abcd',
        maxZoom: 19,
        noCache: true
      })
      .addTo(this.leafletMap);
    this.leafletMap.on('click', this.onClickOnMap);

    // add house pin
    if (this.props.house.latitude && this.props.house.longitude) {
      this.setPinMap(this.props.house.latitude, this.props.house.longitude);
    }
  };

  onClickOnMap = e => {
    this.setPinMap(e.latlng.lat, e.latlng.lng);
    this.props.updateHouseLocation(e.latlng.lat, e.latlng.lng, this.props.houseIndex);
  };

  setPinMap = (latitude, longitude) => {
    if (this.houseMarker) {
      this.houseMarker.setLatLng(leaflet.latLng(latitude, longitude));
    } else {
      this.houseMarker = leaflet
        .marker([latitude, longitude], {
          icon
        })
        .addTo(this.leafletMap);
    }
  };

  setMapRef = map => {
    this.map = map;
  };

  updateSearchQuery = e => {
    this.setState({ searchQuery: e.target.value, searchError: null });
  };

  onKeyPressSearchInput = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.searchAddress();
    }
  };

  searchAddress = async () => {
    const query = (this.state.searchQuery || '').trim();
    if (!query) {
      return;
    }
    this.setState({ searching: true, searchError: null });
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
      );
      const results = await response.json();
      if (!results || results.length === 0) {
        this.setState({ searching: false, searchError: 'noResult' });
        return;
      }
      const { lat, lon } = results[0];
      const latitude = Number(lat);
      const longitude = Number(lon);
      this.setPinMap(latitude, longitude);
      this.leafletMap.setView([latitude, longitude], 15);
      this.props.updateHouseLocation(latitude, longitude, this.props.houseIndex);
      this.setState({ searching: false, searchError: null });
    } catch (e) {
      this.setState({ searching: false, searchError: 'error' });
    }
  };

  constructor(props) {
    super(props);
    this.props = props;
    this.state = {
      searchQuery: '',
      searching: false,
      searchError: null
    };
  }

  componentDidMount() {
    this.initMap();
  }

  componentWillUnmount() {
    this.leafletMap.off('click', this.onClickOnMap);
    this.leafletMap.remove();
  }

  componentDidUpdate(prevProps) {
    // If dark mode state has changed, reinitialize the map
    if (prevProps.darkMode !== this.props.darkMode) {
      this.initMap();
    }
  }

  render() {
    return (
      <div>
        <div class="input-group mb-2">
          <Localizer>
            <input
              type="text"
              class="form-control"
              value={this.state.searchQuery}
              onInput={this.updateSearchQuery}
              onKeyPress={this.onKeyPressSearchInput}
              placeholder={<Text id="signup.configureHouse.houseLocationSearchPlaceHolder" />}
            />
          </Localizer>
          <span class="input-group-append">
            <button
              type="button"
              class="btn btn-secondary"
              disabled={this.state.searching}
              onClick={this.searchAddress}
            >
              <Text id="signup.configureHouse.houseLocationSearchButton" />
            </button>
          </span>
        </div>
        {this.state.searchError === 'noResult' && (
          <div class="text-danger small mb-2">
            <Text id="signup.configureHouse.houseLocationSearchNoResult" />
          </div>
        )}
        {this.state.searchError === 'error' && (
          <div class="text-danger small mb-2">
            <Text id="signup.configureHouse.houseLocationSearchError" />
          </div>
        )}
        <div ref={this.setMapRef} style="width: 100%; height: 300px;" />
      </div>
    );
  }
}

export default connect('darkMode')(MapComponent);
