import { connectDesktop } from './api/desktop.mjs';
import { mountShell } from './controller.mjs';

mountShell({ document, window, api: connectDesktop() });
