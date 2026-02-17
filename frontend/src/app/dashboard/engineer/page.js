'use client';

// ─────────────────────────────────────────────────────────
//  Lucid AI — Engineer Dashboard
//  Real integration-powered repo picker
//
//  Flow:
//    1. Fetch integrations  →  Integration dropdown
//    2. Select integration  →  Fetch repos from /api/integrations/{id}/repos
//    3. Select repo         →  Auto-fill name, fetch branches
//    4. Select branch       →  Ready to create
//    5. "Create Project"    →  POST /api/projects
// ─────────────────────────────────────────────────────────

import {
  GitBranch, Plus, ChevronDown, Check,
  Github, Rocket, Clock, Sparkles,
  ArrowRight, Folder, Search, X, Moon,
  Lock, Plug, Loader2, AlertCircle,
  Globe, CircleDot,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import useFlowStore from '@/store/useFlowStore';

// ── Provider icons ────────────────────────────────────────
function ProviderIcon({ provider, className }) {
  if (provider === 'GITLAB') {
    return <GitBranch className={cn("w-4 h-4 text-orange-500", className)} />;
  }
  return <Github className={cn("w-4 h-4 text-slate-700", className)} />;
}

// ── Searchable Combobox Dropdown ──────────────────────────
function ComboboxDropdown({
  items = [],
  value,
  onChange,
  renderItem,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  loading = false,
  emptyText = 'No items found',
  disabled = false,
  icon: Icon = Folder,
  renderSelected,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const label = item.name || item.full_name || item.label || '';
      return label.toLowerCase().includes(q);
    });
  }, [items, search]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-all",
          disabled
            ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
            : open
              ? "border-blue-300 ring-2 ring-blue-100 bg-white"
              : "bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-600"
        )}
      >
        <div className="flex items-center gap-2.5 truncate min-w-0">
          {renderSelected ? (
            renderSelected(value)
          ) : value ? (
            <>
              <Icon className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="font-medium text-slate-700 truncate">
                {value.name || value.full_name || value.label || 'Selected'}
              </span>
            </>
          ) : (
            <>
              <Icon className="w-4 h-4 text-slate-300 shrink-0" />
              <span className="text-slate-400">{placeholder}</span>
            </>
          )}
        </div>
        {loading ? (
          <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
        ) : (
          <ChevronDown className={cn(
            "w-4 h-4 text-slate-400 shrink-0 transition-transform",
            open && "rotate-180"
          )} />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(''); }} />
          <div
            className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 overflow-hidden z-50 shadow-xl"
            style={{ backgroundColor: '#ffffff' }}
          >
            {/* Search */}
            {items.length > 5 && (
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-100 rounded-lg bg-slate-50 outline-none focus:border-blue-300 text-slate-700"
                    placeholder={searchPlaceholder}
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* List */}
            <div className="max-h-56 overflow-y-auto">
              {loading ? (
                <div className="px-4 py-8 text-center">
                  <Loader2 className="w-5 h-5 text-blue-500 mx-auto mb-2 animate-spin" />
                  <p className="text-xs text-slate-400">Loading…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-slate-400">{emptyText}</p>
                </div>
              ) : (
                filtered.map((item, idx) => (
                  <button
                    key={item.id ?? item.name ?? idx}
                    type="button"
                    onClick={() => {
                      onChange(item);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-all text-left hover:bg-slate-50",
                      value?.id === item.id ? "bg-blue-50 text-blue-700" : "text-slate-600"
                    )}
                  >
                    {renderItem ? renderItem(item, value?.id === item.id) : (
                      <>
                        <span className="font-medium truncate">{item.name || item.label}</span>
                        {value?.id === item.id && <Check className="w-3.5 h-3.5 ml-auto text-blue-600 shrink-0" />}
                      </>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ── Main Page Component ──────────────────────────────────
export default function EngineerDashboardPage() {
  const router = useRouter();
  const { setSelectedRepo, setSourceBranch, setSessionActive } = useFlowStore();

  // ── Integration State ────────────────────────────────
  const [integrations, setIntegrations] = useState([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [selectedIntegration, setSelectedIntegration] = useState(null);

  // ── Repository State ─────────────────────────────────
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo2, setSelectedRepo2] = useState(null);

  // ── Branch State ─────────────────────────────────────
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);

  // ── Project Name ─────────────────────────────────────
  const [projectName, setProjectName] = useState('');

  // ── Model Selector ───────────────────────────────────
  const [selectedModel, setSelectedModel] = useState('anthropic');
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  // ── UI State ─────────────────────────────────────────
  const [isCreating, setIsCreating] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [error, setError] = useState(null);

  // ════════════════════════════════════════════════════
  //  Step 1: Fetch Integrations on Mount
  // ════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIntegrationsLoading(true);
      try {
        const res = await fetch('/api/integrations');
        if (!res.ok) throw new Error('Failed to load integrations');
        const data = await res.json();
        if (!cancelled) {
          setIntegrations(data.integrations || []);
        }
      } catch (err) {
        console.error('Failed to fetch integrations:', err);
      } finally {
        if (!cancelled) setIntegrationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ════════════════════════════════════════════════════
  //  Step 2: Fetch Repos When Integration Selected
  // ════════════════════════════════════════════════════
  const handleIntegrationSelect = useCallback(async (integration) => {
    setSelectedIntegration(integration);
    setSelectedRepo2(null);
    setBranches([]);
    setSelectedBranch(null);
    setProjectName('');
    setError(null);

    setReposLoading(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}/repos`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (err) {
      console.error('Failed to fetch repos:', err);
      setError(`Failed to load repositories: ${err.message}`);
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, []);

  // ════════════════════════════════════════════════════
  //  Step 3: Fetch Branches When Repo Selected
  // ════════════════════════════════════════════════════
  const handleRepoSelect = useCallback(async (repo) => {
    setSelectedRepo2(repo);
    setError(null);

    // Auto-fill project name from repo name
    const name = repo.name || repo.full_name?.split('/').pop() || '';
    setProjectName(name);

    // Pre-select default branch
    const defaultBr = repo.default_branch || 'main';

    setBranchesLoading(true);
    try {
      // Build the query param based on provider
      const provider = selectedIntegration?.provider;
      let url = `/api/integrations/${selectedIntegration.id}/branches`;

      if (provider === 'GITHUB') {
        // GitHub uses owner/repo format
        const fullName = repo.full_name || repo.name;
        url += `?repo=${encodeURIComponent(fullName)}`;
      } else if (provider === 'GITLAB') {
        // GitLab uses numeric project ID
        url += `?projectId=${encodeURIComponent(repo.id)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const branchList = data.branches || [];
      setBranches(branchList);

      // Pre-select default branch
      const defaultMatch = branchList.find(b => b.name === defaultBr);
      setSelectedBranch(defaultMatch || branchList[0] || { name: defaultBr });

    } catch (err) {
      console.error('Failed to fetch branches:', err);
      // Fallback: show only the default branch
      setBranches([{ name: defaultBr, protected: false }]);
      setSelectedBranch({ name: defaultBr });
    } finally {
      setBranchesLoading(false);
    }
  }, [selectedIntegration]);

  // ════════════════════════════════════════════════════
  //  Step 4: Create Project & Launch Workspace
  // ════════════════════════════════════════════════════
  const handleCreateProject = useCallback(async () => {
    if (!selectedRepo2 || !projectName.trim()) return;

    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          repoUrl: selectedRepo2.html_url || selectedRepo2.clone_url || '',
          integrationId: selectedIntegration?.id || null,
          branch: selectedBranch?.name || 'main',
          provider: selectedIntegration?.provider || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const project = data.project;

      // Update flow store for workspace
      setSelectedRepo({ name: project.name, url: project.repoUrl });
      setSourceBranch(project.branch);
      setSessionActive(true);

      // Store model config
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('lucid_model_provider', selectedModel);
        sessionStorage.removeItem('lucid_custom_api_key');
      }

      // Navigate to workspace
      router.push(`/dashboard/engineer/workspace/${encodeURIComponent(project.name)}`);

    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }, [selectedRepo2, projectName, selectedIntegration, selectedBranch, selectedModel, setSelectedRepo, setSourceBranch, setSessionActive, router]);

  // ── Scratch Session ──────────────────────────────────
  const handleNewConversation = () => {
    setSessionActive(true);
    setSelectedRepo({ name: 'scratch-session', lang: '', updated: 'Now', stars: 0 });
    router.push('/dashboard/engineer/workspace/scratch-session');
  };

  // ── Computed State ───────────────────────────────────
  const canCreate = selectedRepo2 && projectName.trim() && selectedBranch && !isCreating;
  const hasIntegrations = integrations.length > 0;

  // ═══════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════
  return (
    <div className="h-full bg-[#f0f4f9] relative flex flex-col">
      <div className="max-w-3xl mx-auto px-8 py-8 flex-1 flex flex-col justify-center w-full">

        {/* Banner */}
        {showBanner && (
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center gap-2 px-5 py-2 bg-white border border-slate-200 rounded-full shadow-soft">
              <span className="text-sm text-slate-500">New around here? Not sure where to start?</span>
              <button className="text-sm text-slate-800 font-bold underline underline-offset-2 hover:text-blue-600 transition-colors">Click here</button>
            </div>
            <button onClick={() => setShowBanner(false)} className="ml-3 text-slate-300 hover:text-slate-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Title */}
        <div className="text-center mb-2">
          <h1 className="text-4xl sm:text-[44px] font-extrabold text-slate-900 tracking-tight leading-tight">
            Let&apos;s Start Building!
          </h1>
        </div>
        <div className="text-center mb-10">
          <p className="text-[15px] text-slate-400 max-w-xl mx-auto leading-relaxed">
            Select a repository to begin an autonomous engineering session or start a fresh environment from scratch.
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-5 flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-700">Error</p>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Two Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-14 relative z-30">

          {/* ════════════════════════════════════════════
              LEFT: Open Repository (Real Data)
          ════════════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-soft relative z-30">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
                <GitBranch className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-[15px] font-bold text-slate-900">Open Repository</h2>
            </div>

            {/* ── 1. Integration Selector ─────────────── */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-4 mb-2">
              Source
            </p>
            <div className="space-y-2.5 mb-4">
              <ComboboxDropdown
                items={integrations}
                value={selectedIntegration}
                onChange={handleIntegrationSelect}
                placeholder="Select source…"
                searchPlaceholder="Search integrations…"
                loading={integrationsLoading}
                emptyText={
                  integrationsLoading
                    ? 'Loading…'
                    : 'No integrations connected'
                }
                icon={Plug}
                renderSelected={(val) => val ? (
                  <div className="flex items-center gap-2.5 truncate">
                    <ProviderIcon provider={val.provider} />
                    <span className="font-medium text-slate-700 truncate">
                      {val.provider === 'GITHUB' ? 'GitHub' : 'GitLab'}
                      {val.label ? ` (${val.label})` : ''}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <Plug className="w-4 h-4 text-slate-300 shrink-0" />
                    <span className="text-slate-400">Select source…</span>
                  </div>
                )}
                renderItem={(item, isSelected) => (
                  <>
                    <ProviderIcon provider={item.provider} />
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "font-medium truncate",
                        isSelected ? "text-blue-700" : "text-slate-700"
                      )}>
                        {item.provider === 'GITHUB' ? 'GitHub' : 'GitLab'}
                        {item.label ? ` — ${item.label}` : ''}
                      </p>
                      {item.externalUsername && (
                        <p className="text-[10px] text-slate-400 truncate">@{item.externalUsername}</p>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-600 shrink-0" />}
                  </>
                )}
              />

              {/* Connect new button */}
              {!integrationsLoading && !hasIntegrations && (
                <button
                  onClick={() => router.push('/dashboard/engineer/integrations')}
                  className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-all"
                >
                  <Plug className="w-3.5 h-3.5" />
                  Connect GitHub or GitLab
                  <ArrowRight className="w-3 h-3 opacity-50" />
                </button>
              )}

              {/* ── 2. Repository Dropdown ──────────────── */}
              {selectedIntegration && (
                <>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1">
                    Repository
                  </p>
                  <ComboboxDropdown
                    items={repos}
                    value={selectedRepo2}
                    onChange={handleRepoSelect}
                    placeholder="Select a repository…"
                    searchPlaceholder="Search repositories…"
                    loading={reposLoading}
                    emptyText="No repositories found"
                    icon={Folder}
                    renderSelected={(val) => val ? (
                      <div className="flex items-center gap-2.5 truncate">
                        <ProviderIcon provider={selectedIntegration.provider} />
                        <span className="font-medium text-slate-700 truncate">
                          {val.full_name || val.name}
                        </span>
                        {val.private && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
                      </div>
                    ) : null}
                    renderItem={(item, isSelected) => (
                      <>
                        <ProviderIcon provider={selectedIntegration.provider} className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={cn(
                              "font-medium truncate",
                              isSelected ? "text-blue-700" : "text-slate-700"
                            )}>
                              {item.full_name || item.name}
                            </p>
                            {item.private && (
                              <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.language && (
                              <span className="text-[10px] text-slate-400">
                                <CircleDot className="w-2.5 h-2.5 inline mr-0.5" />
                                {item.language}
                              </span>
                            )}
                            {item.description && (
                              <span className="text-[10px] text-slate-400 truncate">
                                {item.description}
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-600 shrink-0" />}
                      </>
                    )}
                  />
                </>
              )}

              {/* ── 3. Branch Selector ─────────────────── */}
              {selectedRepo2 && (
                <>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1">
                    Branch
                  </p>
                  <ComboboxDropdown
                    items={branches}
                    value={selectedBranch}
                    onChange={(branch) => setSelectedBranch(branch)}
                    placeholder="Select branch…"
                    searchPlaceholder="Search branches…"
                    loading={branchesLoading}
                    emptyText="No branches found"
                    icon={GitBranch}
                    renderSelected={(val) => val ? (
                      <div className="flex items-center gap-2.5 truncate">
                        <GitBranch className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="font-medium text-slate-700 truncate">{val.name}</span>
                        {val.name === selectedRepo2?.default_branch && (
                          <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-[9px] font-bold text-emerald-600 uppercase shrink-0">
                            default
                          </span>
                        )}
                      </div>
                    ) : null}
                    renderItem={(item, isSelected) => (
                      <>
                        <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className={cn(
                          "font-medium truncate",
                          isSelected ? "text-blue-700" : "text-slate-700"
                        )}>
                          {item.name}
                        </span>
                        {item.name === selectedRepo2?.default_branch && (
                          <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-[9px] font-bold text-emerald-600 uppercase shrink-0">
                            default
                          </span>
                        )}
                        {item.protected && (
                          <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                        {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-600 shrink-0" />}
                      </>
                    )}
                  />
                </>
              )}

              {/* ── Project Name ────────────────────────── */}
              {selectedRepo2 && (
                <>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1">
                    Project Name
                  </p>
                  <input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 placeholder:text-slate-300 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50 transition-all"
                    placeholder="My Project"
                  />
                </>
              )}
            </div>

            {/* ── AI Model Selector ────────────────────── */}
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-1 mb-2">AI Model</p>
            <div className="space-y-2.5 mb-4">
              <div className="relative">
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    {selectedModel === 'google' ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    <span className="font-medium">
                      {selectedModel === 'google' ? 'Gemini 3 Flash Preview' : 'Claude 3.5 Sonnet'}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-0.5">
                      {selectedModel === 'google' ? 'Fast inference' : 'Best for reasoning'}
                    </span>
                  </div>
                  <ChevronDown className={cn("w-4 h-4 text-slate-400 shrink-0 transition-transform", showModelDropdown && "rotate-180")} />
                </button>

                {showModelDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowModelDropdown(false)} />
                    <div className="absolute right-0 top-full mt-1.5 w-full bg-white rounded-xl border border-slate-200 overflow-hidden z-50 shadow-lg" style={{ backgroundColor: '#ffffff', zIndex: 50 }}>
                      <button
                        onClick={() => { setSelectedModel('google'); setShowModelDropdown(false); }}
                        className={cn("w-full flex items-center gap-2.5 px-3.5 py-3 text-sm text-left hover:bg-slate-50 transition-colors", selectedModel === 'google' && "bg-blue-50")}
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        <div className="flex-1">
                          <span className="font-semibold text-slate-900">Gemini 3 Flash Preview</span>
                          <span className="text-[10px] text-slate-500"> · Fast inference</span>
                        </div>
                        {selectedModel === 'google' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                      </button>
                      <button
                        onClick={() => { setSelectedModel('anthropic'); setShowModelDropdown(false); }}
                        className={cn("w-full flex items-center gap-2.5 px-3.5 py-3 text-sm text-left hover:bg-slate-50 transition-colors border-t border-slate-100", selectedModel === 'anthropic' && "bg-blue-50")}
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <div className="flex-1">
                          <div className="font-medium text-slate-700">Claude 3.5 Sonnet</div>
                          <div className="text-[11px] text-slate-400">Best for reasoning · Superior code quality</div>
                        </div>
                        {selectedModel === 'anthropic' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Create Project Button ─────────────────── */}
            <button
              onClick={handleCreateProject}
              disabled={!canCreate}
              className={cn(
                "w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-300",
                canCreate
                  ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 shadow-sm shadow-blue-600/15 active:scale-[0.98]"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
              )}
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  Create Project
                </>
              )}
            </button>
          </div>

          {/* ════════════════════════════════════════════
              RIGHT: Start from Scratch
          ════════════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-soft flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center">
                <Plus className="w-4 h-4 text-violet-600" />
              </div>
              <h2 className="text-[15px] font-bold text-slate-900">Start from Scratch</h2>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed flex-1">
              Start a new conversation that is not connected to an existing repository. Perfect for quick experiments, boilerplates, or prototyping new ideas.
            </p>

            <button
              onClick={handleNewConversation}
              className="w-full mt-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition-all active:scale-[0.98]"
            >
              New Conversation
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Recent Projects ── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-5">
            Recent Projects
          </h3>
          <div className="flex items-center gap-3 py-4">
            <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
              <Clock className="w-4 h-4 text-slate-300" />
            </div>
            <span className="text-sm text-slate-400 italic">No recent conversations</span>
          </div>
        </div>
      </div>

      {/* Dark mode toggle */}
      <button className="fixed bottom-6 right-6 w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-soft hover:shadow-md transition-all z-30">
        <Moon className="w-4.5 h-4.5 text-slate-400" />
      </button>
    </div>
  );
}
