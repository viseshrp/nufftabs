/**
 * Options page entrypoint. Loads shared styles and bootstraps the settings UI.
 */
import './style.css';
import { initSettingsPage } from './settings_page';
import { logExtensionError } from '../shared/utils';

void initSettingsPage().catch((error) => {
  logExtensionError('Failed to initialize settings page', error, { operation: 'runtime_context' });
});
