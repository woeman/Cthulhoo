import '../art/tokens/tokens.css';
import '../art/css/fonts.css';
import './styles/app.css';
import { App } from './app';
import { setEphemeral } from './game/storage';
import { ARTIFACT } from './env';

// ?fresh plays without reading or writing saved progress (previews, demos).
const params = new URLSearchParams(location.search);
if (params.has('fresh')) setEphemeral(true);

const root = document.getElementById('app');
if (root) new App(root).start();

// Offline play once installed. Only on https, so local dev never caches stale builds.
if (!ARTIFACT && 'serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && !params.has('fresh')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline play is a bonus; the game works without it */
    });
  });
}
