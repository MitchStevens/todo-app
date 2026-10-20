import { useEffect, useState } from 'preact/hooks';
import type { Navigate } from './App';
import { useRepo } from './hooks';
import { BackIcon } from './icons';

interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
}

export function Settings({ go }: { go: Navigate }) {
  const repo = useRepo();
  const [info, setInfo] = useState<StorageInfo>({ persisted: null, usage: null });
  const [message, setMessage] = useState<string | null>(null);

  const refreshInfo = async () => {
    const persisted = (await navigator.storage?.persisted?.()) ?? null;
    const estimate = await navigator.storage?.estimate?.();
    setInfo({ persisted, usage: estimate?.usage ?? null });
  };
  useEffect(() => {
    void refreshInfo();
  }, []);

  const requestPersist = async () => {
    const ok = await navigator.storage?.persist?.();
    setMessage(ok ? 'Storage is now protected.' : 'The browser said no. Installing the app usually fixes this.');
    void refreshInfo();
  };

  const exportData = () => {
    const blob = new Blob([repo.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `next-up-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    if (!confirm('Replace everything in the app with this backup?')) return;
    try {
      await repo.importJson(await file.text());
      setMessage('Backup restored.');
    } catch (e) {
      setMessage(`Could not restore: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const { data } = repo;
  const counts = [
    [data.tasks.length, 'tasks'],
    [data.comparisons.length, 'answers'],
    [data.tradeoffs.length, '“which first?” choices'],
    [data.contextLogs.length, 'sessions'],
  ] as const;

  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Back to tasks" onClick={() => go({ name: 'list' })}>
          <BackIcon />
        </button>
      </div>
      <h1>Settings</h1>

      <h2>Your data</h2>
      <div class="box">
        <div>Everything is stored on this device only, in the browser's database. Nothing is sent anywhere.</div>
        <div class="muted small">{counts.map(([n, label]) => `${n} ${label}`).join(' · ')}</div>
        {info.usage !== null && <div class="muted small">Using {(info.usage / 1024).toFixed(0)} KB</div>}
        <div class="small">
          {info.persisted === true && 'Protected: the browser won’t clear it to free up space.'}
          {info.persisted === false && 'Not protected yet: the browser may clear it if space runs low.'}
          {info.persisted === null && 'This browser can’t say whether the data is protected.'}
        </div>
        {repo.lastError && <div class="error">Last save failed: {repo.lastError}</div>}
      </div>
      {info.persisted === false && (
        <button class="btn block" onClick={requestPersist}>
          Protect my data
        </button>
      )}

      <h2>Backup</h2>
      <p class="muted small" style="margin:0">
        Clearing site data or uninstalling the app deletes everything. Export a backup now and then.
      </p>
      <button class="btn block" onClick={exportData}>
        Export backup
      </button>
      <label class="btn block" style="cursor:pointer">
        Restore from backup…
        <input
          type="file"
          accept="application/json,.json"
          style="display:none"
          onChange={(e) => void importData(e.currentTarget.files?.[0])}
        />
      </label>
      {message && <p class="small">{message}</p>}
    </main>
  );
}
