import { render } from 'preact';
import { Repo } from './store/repo';
import { App } from './ui/App';
import './styles.css';

async function start() {
  const root = document.getElementById('app')!;
  try {
    const repo = await Repo.open();
    // Ask the browser not to evict our data under storage pressure.
    // Chrome on Android grants this to installed apps without a prompt.
    void navigator.storage?.persist?.();
    render(<App repo={repo} />, root);
  } catch (e) {
    root.textContent = `Could not open the database: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('./sw.js');
  }
}

void start();
