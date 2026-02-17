// ─────────────────────────────────────────────────────────
//  Lucid AI — GitLab API Service
//  Authenticated calls to GitLab REST API v4
// ─────────────────────────────────────────────────────────

const DEFAULT_GITLAB_URL = 'https://gitlab.com';

/**
 * Resolve the GitLab API base URL.
 * Supports self-hosted instances via GITLAB_URL env var.
 */
function getApiBase() {
  const base = process.env.GITLAB_URL || DEFAULT_GITLAB_URL;
  return `${base.replace(/\/+$/, '')}/api/v4`;
}

/**
 * Build standard GitLab headers with Bearer auth.
 * @param {string} token — GitLab Personal Access Token
 */
function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * List projects the authenticated user is a member of.
 *
 * @param   {string} token — GitLab PAT
 * @param   {Object} [opts]
 * @param   {number} [opts.perPage=100] — Results per page
 * @param   {string} [opts.orderBy='last_activity_at'] — Order by field
 * @returns {Promise<Array<{
 *   id: number,
 *   name: string,
 *   path_with_namespace: string,
 *   visibility: string,
 *   web_url: string,
 *   http_url_to_repo: string,
 *   default_branch: string|null,
 *   description: string|null,
 *   last_activity_at: string,
 * }>>}
 */
export async function listUserProjects(token, opts = {}) {
  const {
    perPage = 100,
    orderBy = 'last_activity_at',
  } = opts;

  const apiBase = getApiBase();
  const url = new URL(`${apiBase}/projects`);
  url.searchParams.set('membership', 'true');
  url.searchParams.set('simple', 'true');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('order_by', orderBy);
  url.searchParams.set('sort', 'desc');

  const res = await fetch(url.toString(), {
    headers: headers(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitLab API error ${res.status}: ${body.slice(0, 200)}`
    );
  }

  const projects = await res.json();

  // Return a clean, normalized shape
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    path_with_namespace: p.path_with_namespace,
    // Normalize to match GitHub's "full_name" concept
    full_name: p.path_with_namespace,
    visibility: p.visibility,           // public, internal, private
    private: p.visibility === 'private',
    web_url: p.web_url,
    html_url: p.web_url,                // alias for GitHub compat
    http_url_to_repo: p.http_url_to_repo,
    clone_url: p.http_url_to_repo,      // alias for GitHub compat
    default_branch: p.default_branch || 'main',
    description: p.description || null,
    language: null,                      // GitLab doesn't return this in simple mode
    last_activity_at: p.last_activity_at,
    updated_at: p.last_activity_at,      // alias for GitHub compat
  }));
}

/**
 * List branches for a specific GitLab project.
 *
 * @param   {string} token     — GitLab PAT
 * @param   {number|string} projectId — GitLab project ID (numeric)
 * @returns {Promise<Array<{
 *   name: string,
 *   protected: boolean,
 * }>>}
 */
export async function listBranches(token, projectId) {
  const apiBase = getApiBase();
  const url = `${apiBase}/projects/${encodeURIComponent(projectId)}/repository/branches?per_page=100`;

  const res = await fetch(url, {
    headers: headers(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitLab API error ${res.status}: ${body.slice(0, 200)}`
    );
  }

  const branches = await res.json();

  return branches.map((b) => ({
    name: b.name,
    protected: b.protected || false,
  }));
}

/**
 * Get the authenticated user's profile info.
 * Useful for showing "Connected as @username".
 *
 * @param   {string} token — GitLab PAT
 * @returns {Promise<{ username: string, name: string|null, avatar_url: string }>}
 */
export async function getAuthenticatedUser(token) {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/user`, {
    headers: headers(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`GitLab API error ${res.status}`);
  }

  const user = await res.json();
  return {
    username: user.username,
    // Normalize to match GitHub field name
    login: user.username,
    name: user.name || null,
    avatar_url: user.avatar_url,
  };
}
