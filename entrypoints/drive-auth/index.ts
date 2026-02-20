/** Entrypoint for the Drive auth page. */
import './style.css';
import { initDriveAuthPage } from './drive_auth_page';
import { logExtensionError } from '../shared/utils';

void initDriveAuthPage().catch((error) => {
  logExtensionError('Failed to initialize Drive auth page', error, { operation: 'runtime_context' });
});
