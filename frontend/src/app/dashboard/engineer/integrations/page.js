'use client';

import { 
  Github, ChevronDown, ExternalLink, Check, 
  AlertCircle, User, Mail, X, Plus,
  Trash2, Pencil, Loader2, CheckCircle2, XCircle, ShieldAlert
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

/* ════════════════════════════════════════════════════════════
   SVG ICONS
   ════════════════════════════════════════════════════════════ */

function GitLabIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51a.42.42 0 01.82 0l2.44 7.51h8.06l2.44-7.51a.42.42 0 01.82 0l2.44 7.51 1.22 3.78a.84.84 0 01-.3.94z" />
    </svg>
  );
}

function NotionIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.19 2.2c-.42-.28-.98-.606-2.052-.513l-12.8.93c-.466.047-.56.28-.373.466l1.494 1.125zm.793 3.08v13.904c0 .747.373 1.026 1.214.98l14.523-.84c.84-.046.933-.56.933-1.166V6.368c0-.606-.233-.886-.747-.84l-15.177.84c-.56.047-.746.28-.746.92zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.571-7.178v6.952l1.447.327s0 .84-1.167.84l-3.219.187c-.093-.187 0-.653.327-.747l.84-.213V8.957l-1.166-.093c-.094-.42.14-1.026.793-1.073l3.453-.233 4.759 7.272V8.49l-1.213-.14c-.094-.514.28-.886.747-.933l3.22-.187z"/>
    </svg>
  );
}


/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
   ════════════════════════════════════════════════════════════ */

function Toast({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const isSuccess = toast.type === 'success';

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-3.5 rounded-2xl border shadow-xl backdrop-blur-sm transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        isSuccess
          ? "bg-emerald-50/95 border-emerald-200 text-emerald-800"
          : "bg-red-50/95 border-red-200 text-red-800"
      )}
    >
      {isSuccess ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
      ) : (
        <XCircle className="w-5 h-5 text-red-500 shrink-0" />
      )}
      <p className="text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 300); }}
        className="ml-2 p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   GITHUB ACCORDION CARD
   ════════════════════════════════════════════════════════════ */

function GitHubCard({ integration, onRefresh, addToast }) {
  const [expanded, setExpanded] = useState(false);
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState(null);

  const connected = !!integration;
  const username = integration?.externalUsername;

  const handleConnect = async () => {
    if (!token.trim()) return;
    setError(null);
    setIsVerifying(true);

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'GITHUB',
          token: token.trim(),
          label: label.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid token or missing scopes.');
        setIsVerifying(false);
        return;
      }

      const connectedUser = data.integration?.externalUsername;
      addToast(
        connectedUser
          ? `Successfully connected as @${connectedUser}`
          : 'GitHub integration connected successfully.',
        'success'
      );
      setToken('');
      setLabel('');
      setExpanded(false);
      onRefresh();
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration?.id) return;
    try {
      const res = await fetch(`/api/integrations?id=${integration.id}`, { method: 'DELETE' });
      if (res.ok) {
        addToast('GitHub integration disconnected.', 'success');
        onRefresh();
      } else {
        addToast('Failed to disconnect.', 'error');
      }
    } catch {
      addToast('Network error while disconnecting.', 'error');
    }
  };

  return (
    <div className={cn(
      "bg-white rounded-2xl border overflow-hidden transition-all duration-300",
      connected ? "border-emerald-200" : "border-slate-200",
      expanded && "shadow-card"
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50/50 transition-all"
      >
        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
          <Github className="w-6 h-6 text-slate-900" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">GitHub</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            {connected ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">
                  Connected as <span className="font-bold">@{username || '...'}</span>
                </span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                <span className="text-xs font-medium text-slate-400">Not connected</span>
              </>
            )}
          </div>
        </div>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 border border-slate-200 shrink-0 transition-transform",
          expanded && "rotate-180"
        )}>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </button>

      {/* Expanded Content */}
      <div className={cn(
        "overflow-hidden transition-all duration-300 ease-in-out",
        expanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-5">
          {/* Error Alert */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl animate-shake">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Connection Failed</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="ml-auto p-1 rounded-lg hover:bg-red-100 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          )}

          {/* Label */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Label <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={isVerifying}
              placeholder="e.g. Personal GitHub"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Token */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
              {connected && (
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-600" />
                </span>
              )}
              GitHub Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isVerifying}
              placeholder={connected ? '••••••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
              className={cn(
                "w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-sm text-slate-700 placeholder-slate-400 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                error
                  ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/10"
                  : "border-slate-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
              )}
            />
          </div>

          {/* Help */}
          <p className="text-xs text-slate-400">
            Need a token?{' '}
            <a
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-500 underline underline-offset-2 inline-flex items-center gap-1"
            >
              Create one on GitHub <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {connected ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={handleConnect}
              disabled={!token.trim() || isVerifying}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-sm min-w-[190px] justify-center",
                isVerifying
                  ? "bg-blue-500 text-white cursor-wait"
                  : !token.trim()
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/15"
              )}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying with GitHub...
                </>
              ) : connected ? (
                'Update Token'
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   GITLAB ACCORDION CARD
   ════════════════════════════════════════════════════════════ */

function GitLabCard({ integration, onRefresh, addToast }) {
  const [expanded, setExpanded] = useState(false);
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('https://gitlab.com');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState(null);

  const connected = !!integration;
  const username = integration?.externalUsername;

  const handleConnect = async () => {
    if (!token.trim()) return;
    setError(null);
    setIsVerifying(true);

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'GITLAB',
          token: token.trim(),
          label: label.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid token or missing scopes.');
        setIsVerifying(false);
        return;
      }

      const connectedUser = data.integration?.externalUsername;
      addToast(
        connectedUser
          ? `Successfully connected as @${connectedUser}`
          : 'GitLab integration connected successfully.',
        'success'
      );
      setToken('');
      setLabel('');
      setExpanded(false);
      onRefresh();
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration?.id) return;
    try {
      const res = await fetch(`/api/integrations?id=${integration.id}`, { method: 'DELETE' });
      if (res.ok) {
        addToast('GitLab integration disconnected.', 'success');
        onRefresh();
      } else {
        addToast('Failed to disconnect.', 'error');
      }
    } catch {
      addToast('Network error while disconnecting.', 'error');
    }
  };

  return (
    <div className={cn(
      "bg-white rounded-2xl border overflow-hidden transition-all duration-300",
      connected ? "border-emerald-200" : "border-slate-200",
      expanded && "shadow-card"
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50/50 transition-all"
      >
        <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
          <GitLabIcon className="w-6 h-6 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">GitLab</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            {connected ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">
                  Connected as <span className="font-bold">@{username || '...'}</span>
                </span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                <span className="text-xs font-medium text-slate-400">Not connected</span>
              </>
            )}
          </div>
        </div>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 border border-slate-200 shrink-0 transition-transform",
          expanded && "rotate-180"
        )}>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </button>

      {/* Expanded Content */}
      <div className={cn(
        "overflow-hidden transition-all duration-300 ease-in-out",
        expanded ? "max-h-[700px] opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-5">
          {/* Error Alert */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl animate-shake">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Connection Failed</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="ml-auto p-1 rounded-lg hover:bg-red-100 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          )}

          {/* Label */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Label <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={isVerifying}
              placeholder="e.g. Work GitLab"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Token */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
              {connected && (
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-600" />
                </span>
              )}
              GitLab Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isVerifying}
              placeholder={connected ? '••••••••••••••••••••' : 'glpat-xxxxxxxxxxxxxxxxxxxx'}
              className={cn(
                "w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-sm text-slate-700 placeholder-slate-400 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                error
                  ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/10"
                  : "border-slate-200 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
              )}
            />
          </div>

          {/* Host */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
              {host && (
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check className="w-3 h-3 text-emerald-600" />
                </span>
              )}
              GitLab Host <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={isVerifying}
              placeholder="https://gitlab.com"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Help */}
          <p className="text-xs text-slate-400">
            Need a token?{' '}
            <a
              href="https://gitlab.com/-/user_settings/personal_access_tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-500 underline underline-offset-2 inline-flex items-center gap-1"
            >
              Create one on GitLab <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {connected ? (
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={handleConnect}
              disabled={!token.trim() || isVerifying}
              className={cn(
                "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-sm min-w-[190px] justify-center",
                isVerifying
                  ? "bg-blue-500 text-white cursor-wait"
                  : !token.trim()
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/15"
              )}
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying with GitLab...
                </>
              ) : connected ? (
                'Update Token'
              ) : (
                'Connect'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   NOTION CARD (Multi-project — unchanged)
   ════════════════════════════════════════════════════════════ */

function NotionCard() {
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const [projects, setProjects] = useState([
    { id: 1, name: 'Lucid AI', databaseId: '21593460...', active: true },
    { id: 2, name: 'Lodify', databaseId: '2c505496...', active: false },
  ]);

  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newDbId, setNewDbId] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editDbId, setEditDbId] = useState('');

  const handleAddProject = () => {
    if (!newName.trim() || !newToken.trim() || !newDbId.trim()) return;
    setProjects([...projects, {
      id: Date.now(),
      name: newName,
      databaseId: newDbId,
      active: false,
    }]);
    setNewName('');
    setNewToken('');
    setNewDbId('');
    setShowNewForm(false);
  };

  const handleDelete = (id) => {
    setProjects(projects.filter(p => p.id !== id));
  };

  const handleSetActive = (id) => {
    setProjects(projects.map(p => ({
      ...p,
      active: p.id === id,
    })));
  };

  const startEdit = (project) => {
    setEditingId(project.id);
    setEditName(project.name);
    setEditDbId(project.databaseId);
    setEditToken('secret_...');
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) return;
    setProjects(projects.map(p => p.id === editingId ? {
      ...p,
      name: editName,
      databaseId: editDbId,
    } : p));
    setEditingId(null);
  };

  const projectCount = projects.length;

  return (
    <div className={cn(
      "bg-white rounded-2xl border overflow-hidden transition-all duration-300",
      connected ? "border-emerald-200" : "border-slate-200",
      expanded && "shadow-card"
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50/50 transition-all"
      >
        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
          <NotionIcon className="w-6 h-6 text-slate-800" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900">Notion</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-slate-300")} />
            <span className={cn("text-xs font-medium", connected ? "text-emerald-600" : "text-slate-400")}>
              {projectCount} Projects
            </span>
          </div>
        </div>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 border border-slate-200 shrink-0 transition-transform",
          expanded && "rotate-180"
        )}>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </button>

      {/* Expanded Content */}
      <div className={cn(
        "overflow-hidden transition-all duration-300 ease-in-out",
        expanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
      )}>
        <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-4">
          {/* Section Header */}
          <div className="flex items-center justify-between">
            <h4 className="text-base font-bold text-slate-900">Notion Projects</h4>
            <button
              onClick={() => { setShowNewForm(true); setEditingId(null); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/15"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>

          {/* New Project Form */}
          {showNewForm && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 animate-slide-down">
              <h5 className="text-sm font-bold text-slate-900">New Project</h5>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">Project Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. My Startup"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">Notion Integration Token</label>
                <input
                  type="text"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="secret_..."
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">Notion Database ID</label>
                <input
                  type="text"
                  value={newDbId}
                  onChange={(e) => setNewDbId(e.target.value)}
                  placeholder="32-char ID from URL"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleAddProject}
                  disabled={!newName.trim() || !newToken.trim() || !newDbId.trim()}
                  className={cn(
                    "px-5 py-2 rounded-xl text-sm font-bold transition-all",
                    newName.trim() && newToken.trim() && newDbId.trim()
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  )}
                >
                  Save Project
                </button>
                <button
                  onClick={() => { setShowNewForm(false); setNewName(''); setNewToken(''); setNewDbId(''); }}
                  className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Project List */}
          <div className="space-y-2">
            {projects.map((project) => (
              <div key={project.id}>
                {editingId === project.id ? (
                  /* Edit Mode */
                  <div className="bg-slate-50 border border-blue-200 rounded-xl p-5 space-y-4 animate-fade-in">
                    <h5 className="text-sm font-bold text-slate-900">Edit Project</h5>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1.5 block">Project Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1.5 block">Notion Integration Token</label>
                      <input
                        type="text"
                        value={editToken}
                        onChange={(e) => setEditToken(e.target.value)}
                        placeholder="secret_..."
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1.5 block">Notion Database ID</label>
                      <input
                        type="text"
                        value={editDbId}
                        onChange={(e) => setEditDbId(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={handleSaveEdit}
                        className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display Mode */
                  <div className={cn(
                    "flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all",
                    project.active
                      ? "bg-blue-50 border-blue-200"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  )}>
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <NotionIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{project.name}</span>
                        {project.active && (
                          <span className="px-2 py-0.5 bg-emerald-100 border border-emerald-200 rounded text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Database ID: {project.databaseId}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!project.active && (
                        <button
                          onClick={() => handleSetActive(project.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                          title="Set as active"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(project)}
                        className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(project.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   MAIN INTEGRATIONS PAGE
   ════════════════════════════════════════════════════════════ */

export default function IntegrationsPage() {
  const [gitUsername, setGitUsername] = useState('AI Engineer');
  const [gitEmail, setGitEmail] = useState('ai@lucid.ai');

  // ── Integration data from API ──────────────────────
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Toast notifications ────────────────────────────
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Fetch integrations from API ────────────────────
  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations');
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
      }
    } catch (err) {
      console.error('Failed to fetch integrations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // ── Helpers ────────────────────────────────────────
  const githubIntegration = integrations.find((i) => i.provider === 'GITHUB');
  const gitlabIntegration = integrations.find((i) => i.provider === 'GITLAB');

  return (
    <div className="min-h-full bg-[#f5f7fa]">
      <div className="px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-1">
            Integrations
          </h1>
          <p className="text-sm text-slate-500">
            Configure the username and email that OpenHands uses to commit changes.
          </p>
        </div>

        {/* Integration Cards */}
        <div className="space-y-3 mb-8">
          {loading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-200 px-5 py-4 animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 bg-slate-100 rounded" />
                      <div className="h-3 w-32 bg-slate-50 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <GitHubCard
                integration={githubIntegration}
                onRefresh={fetchIntegrations}
                addToast={addToast}
              />
              <GitLabCard
                integration={gitlabIntegration}
                onRefresh={fetchIntegrations}
                addToast={addToast}
              />
              <NotionCard />
            </>
          )}
        </div>

        {/* Git Settings */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-soft">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Git Settings</h3>
          <p className="text-xs text-slate-500 mb-5">Configure the username and email that OpenHands uses to commit changes.</p>
          
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={gitUsername}
                  onChange={(e) => setGitUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={gitEmail}
                  onChange={(e) => setGitEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>
            </div>
            <button className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/15">
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* ── Toast notifications ── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Inline animations ── */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
        .animate-shake { animation: shake 0.4s ease-out; }
      `}</style>
    </div>
  );
}
