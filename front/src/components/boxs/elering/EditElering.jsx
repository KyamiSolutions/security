import { Text } from 'preact-i18n';
import BaseEditBox from '../baseEditBox';

const EditElering = ({ ...props }) => (
  <BaseEditBox {...props} titleKey="dashboard.boxTitle.elering">
    <Text id="dashboard.boxes.elering.description" />
  </BaseEditBox>
);

export default EditElering;
