import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { reviewDevUpgrade } from './services/review-dev-upgrade.js';
// Reload review and live candle snapshot middleware without restarting Node.
export default defineConfig({plugins:[tailwindcss(),reviewDevUpgrade()]});
