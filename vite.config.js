import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { reviewDevUpgrade } from './services/review-dev-upgrade.js';
// Reload the review middleware during development without restarting Node.
export default defineConfig({plugins:[tailwindcss(),reviewDevUpgrade()]});
