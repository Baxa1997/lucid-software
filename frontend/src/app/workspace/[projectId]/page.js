'use client';

// ─────────────────────────────────────────────────────────
//  Lucid AI — Workspace Page (public route)
//  Redirects to the engineer workspace
// ─────────────────────────────────────────────────────────

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId || 'unknown';

  useEffect(() => {
    router.replace(`/dashboard/engineer/workspace/${encodeURIComponent(projectId)}`);
  }, [projectId, router]);

  return (
    <div className="h-screen flex items-center justify-center bg-[#f5f7fa]">
      <div className="flex items-center gap-3 text-slate-400">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">Redirecting to workspace…</span>
      </div>
    </div>
  );
}
