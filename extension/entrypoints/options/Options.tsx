import { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../../utils/storage';
import { testConnection } from '../../utils/api';

type Status = 'idle' | 'testing' | 'success' | 'error';

export default function Options() {
  const [apiUrl, setApiUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setToken(s.token);
    });
  }, []);

  async function handleSave() {
    await saveSettings(apiUrl, token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTest() {
    if (!token) {
      setStatus('error');
      setMessage('Jeton manquant.');
      return;
    }
    setStatus('testing');
    setMessage('');
    try {
      // Save first so testConnection uses latest values
      await saveSettings(apiUrl, token);
      await testConnection();
      setStatus('success');
      setMessage('Connexion reussie !');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Erreur de connexion.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">TubLyTI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure la connexion a ton instance TubLyTI.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-foreground mb-1">
            URL de TubLyTI
          </label>
          <input
            id="url"
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://tublyti.vercel.app"
            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <div>
          <label htmlFor="token" className="block text-sm font-medium text-foreground mb-1">
            Jeton API
          </label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="tly_xxxxxxxxxxxx"
            className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Trouve ton jeton dans Reglages &gt; Acces API.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-ink transition-colors"
        >
          Enregistrer
        </button>
        <button
          onClick={handleTest}
          disabled={status === 'testing'}
          className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {status === 'testing' ? 'Test en cours...' : 'Tester la connexion'}
        </button>
        {saved && (
          <span className="text-sm text-success font-medium">Enregistre !</span>
        )}
      </div>

      {status !== 'idle' && status !== 'testing' && (
        <div
          className={`text-sm px-3 py-2 rounded-lg ${
            status === 'success'
              ? 'bg-green-50 text-success'
              : 'bg-red-50 text-destructive'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
