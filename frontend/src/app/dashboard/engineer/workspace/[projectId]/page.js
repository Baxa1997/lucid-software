'use client';

// ─────────────────────────────────────────────────────────
//  Lucid AI — Workspace Conversation Page
//  Pure chat + terminal — no file explorer, no code editor
// ─────────────────────────────────────────────────────────

import { useState, useRef, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Send, Terminal, Settings, Minimize2,
  Bot, User, Cpu, ArrowDown, Loader2,
} from 'lucide-react';
import { useAgentSession } from '@/hooks/useAgentSession';

// ── Status Badge ───────────────────────────────────────────
function ConnectionStatus({ status, error }) {
  const config = {
    idle:       { color: 'text-slate-400', label: 'Idle' },
    connecting: { color: 'text-blue-600',  label: 'Connecting...' },
    connected:  { color: 'text-emerald-600', label: 'Connected' },
    error:      { color: 'text-red-600',   label: 'Error' },
  };
  const current = config[status] || config.idle;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full shadow-sm">
      <div className={cn("w-2 h-2 rounded-full",
        status === 'connected' ? "bg-emerald-500" :
        status === 'connecting' ? "bg-blue-500 animate-pulse" :
        status === 'error' ? "bg-red-500" : "bg-slate-300"
      )} />
      <span className={cn("text-xs font-semibold", current.color)}>
        {error || current.label}
      </span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────
export default function ConversationPage({ params }) {
  const { projectId } = use(params);
  const router = useRouter();
  const decodedProjectId = decodeURIComponent(projectId || 'unknown');

  // ── Agent Hook ─────────────────────────────────────────
  const {
    status,
    messages,
    terminalLogs,
    error,
    sendMessage,
  } = useAgentSession({
    projectId: decodedProjectId,
    token: '',
  });

  // ── State ──────────────────────────────────────────────
  const [chatInput, setChatInput] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const chatEndRef = useRef(null);
  const logsEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  // ── Auto-scroll ────────────────────────────────────────
  useEffect(() => {
    if (!showScrollBtn) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showScrollBtn]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs]);

  // ── Handlers ───────────────────────────────────────────
  const handleSend = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage(chatInput.trim());
    setChatInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleChatScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  };

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#f5f7fa] overflow-hidden">

      {/* ── Header ────────────────────────────────────── */}
      <header className="shrink-0 h-14 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-5 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/engineer')}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-slate-200" />

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-900">{decodedProjectId}</h1>
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wide">
                AI Session
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionStatus status={status} error={error} />

          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={cn(
              "p-2 rounded-lg transition-all border",
              showTerminal
                ? "bg-slate-100 text-slate-900 border-slate-300"
                : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
            )}
            title="Toggle Terminal"
          >
            <Terminal className="w-4 h-4" />
          </button>

          <button
            onClick={() => router.push('/dashboard/engineer/settings')}
            className="p-2 text-slate-400 hover:text-slate-900 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Chat + Terminal  ───────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* ── Chat Messages ────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          ref={chatContainerRef}
          onScroll={handleChatScroll}
        >
          {/* Welcome */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-6">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">
                How can I help?
              </h3>
              <p className="text-sm text-slate-500 max-w-md leading-relaxed mb-6">
                Describe what you&apos;d like to build or fix. I&apos;ll write code,
                run commands, and debug your application.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  "Create a login form",
                  "Debug the API",
                  "Setup Tailwind",
                  "Optimize the database",
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => setChatInput(suggestion)}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-600 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="space-y-5 max-w-3xl mx-auto w-full">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3",
                  msg.type === 'user' ? "flex-row-reverse" : "flex-row"
                )}
              >
                {/* Avatar */}
                <div className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                  msg.type === 'user'
                    ? "bg-slate-900 text-white"
                    : msg.type === 'agent'
                    ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
                    : "bg-slate-100 text-slate-400"
                )}>
                  {msg.type === 'user' ? <User className="w-4 h-4" /> :
                   msg.type === 'agent' ? <Bot className="w-4 h-4" /> :
                   <Cpu className="w-4 h-4" />}
                </div>

                {/* Bubble */}
                <div className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm",
                  msg.type === 'user'
                    ? "bg-slate-900 text-white rounded-br-md"
                    : msg.type === 'agent'
                    ? "bg-white border border-slate-200 text-slate-700 rounded-bl-md"
                    : "bg-slate-50 border border-slate-100 text-slate-500 text-xs italic rounded-bl-md"
                )}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {status === 'connecting' && (
              <div className="flex items-center gap-3 px-2">
                <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                </div>
                <span className="text-xs font-medium text-slate-400 animate-pulse">
                  Agent is thinking…
                </span>
              </div>
            )}

            <div ref={chatEndRef} className="h-2" />
          </div>
        </div>

        {/* ── Chat Input ───────────────────────────────── */}
        <div className="shrink-0 px-4 py-4 border-t border-slate-200 bg-white/80 backdrop-blur-md">
          {showScrollBtn && (
            <button
              onClick={() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="mb-3 mx-auto block bg-slate-900/80 text-white px-5 py-2 rounded-full text-xs font-semibold backdrop-blur-md shadow-lg flex items-center gap-2 hover:bg-slate-900 transition-colors"
            >
              <ArrowDown className="w-3 h-3" />
              Scroll to latest
            </button>
          )}

          <form
            onSubmit={handleSend}
            className="relative bg-white border border-slate-200 rounded-2xl focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-all overflow-hidden max-w-3xl mx-auto shadow-sm"
          >
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the agent to build, fix, or explain something…"
              className="w-full px-5 py-4 min-h-[52px] max-h-[140px] outline-none text-sm text-slate-900 placeholder:text-slate-400 resize-none bg-transparent leading-relaxed"
              rows={1}
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <p className="text-[10px] text-slate-400 pl-2">
                <kbd className="px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-500 text-[9px]">Enter</kbd> to send · <kbd className="px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-500 text-[9px]">Shift+Enter</kbd> for new line
              </p>
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className={cn(
                  "p-2.5 rounded-xl transition-all",
                  chatInput.trim()
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 active:scale-95"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                )}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>

        {/* ── Terminal Panel (collapsible) ──────────────── */}
        {showTerminal && (
          <div className="shrink-0 h-[200px] bg-[#1e1e2e] border-t border-[#2a2b3d] flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#16171f] border-b border-[#2a2b3d]">
              <div className="flex items-center gap-2 text-slate-400">
                <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Terminal
                </span>
                {terminalLogs.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-[#2a2b3d] rounded text-[10px] text-slate-500">
                    {terminalLogs.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowTerminal(false)}
                className="p-1 text-slate-500 hover:text-white transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed custom-scrollbar">
              {terminalLogs.length === 0 ? (
                <div className="flex items-center gap-2 text-slate-600 py-2">
                  <span>Waiting for output…</span>
                </div>
              ) : (
                terminalLogs.map((log) => (
                  <div key={log.id} className="mb-0.5 break-all">
                    <span className={cn(
                      "whitespace-pre-wrap",
                      log.content?.includes('[ERROR]') ? "text-red-400" :
                      log.content?.startsWith('$') ? "text-emerald-400 font-bold" :
                      "text-slate-300"
                    )}>
                      {log.content}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
