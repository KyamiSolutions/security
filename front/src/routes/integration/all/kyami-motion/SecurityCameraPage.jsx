import { Text } from 'preact-i18n';
import { Link } from 'preact-router/match';

const SecurityCameraPage = ({ children }) => (
  <div class="page">
    <div class="page-main">
      <div class="my-3 my-md-5">
        <div class="container">
          <div class="row">
            <div class="col-lg-3">
              <h3 class="page-title mb-5">
                <Text id="integration.kyamiMotion.title">Security Camera</Text>
              </h3>
              <div>
                <div class="list-group list-group-transparent mb-0">
                  <Link
                    href="/dashboard/integration/device/kyami-motion"
                    activeClassName="active"
                    class="list-group-item list-group-item-action d-flex align-items-center"
                  >
                    <span class="icon mr-3">
                      <i class="fe fe-camera" />
                    </span>
                    <Text id="integration.kyamiMotion.camerasTab">Cameras</Text>
                  </Link>

                  <Link
                    href="/dashboard/integration/device/kyami-motion/recordings"
                    activeClassName="active"
                    class="list-group-item list-group-item-action d-flex align-items-center"
                  >
                    <span class="icon mr-3">
                      <i class="fe fe-film" />
                    </span>
                    <Text id="integration.kyamiMotion.recordingsTab">Recordings</Text>
                  </Link>

                  <Link
                    href="/dashboard/integration/device/kyami-motion/settings"
                    activeClassName="active"
                    class="list-group-item list-group-item-action d-flex align-items-center"
                  >
                    <span class="icon mr-3">
                      <i class="fe fe-settings" />
                    </span>
                    <Text id="integration.kyamiMotion.settingsTab">Notifications</Text>
                  </Link>
                </div>
              </div>
            </div>

            <div class="col-lg-9">{children}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default SecurityCameraPage;
