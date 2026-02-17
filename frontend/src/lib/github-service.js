// ─────────────────────────────────────────────────────────
//  Lucid AI — GitHub API Service
//  Authenticated calls to GitHub REST API v3
// ─────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

/**
 * Build standard GitHub headers with PAT auth.
 * @param {string} token — GitHub Personal Access Token
 */
function headers(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Lucid-AI-SaaS',
  };
}

/**
 * List repositories the authenticated user has access to.
 *
 * @param   {string} token — GitHub PAT
 * @param   {Object} [opts]
 * @param   {number} [opts.perPage=100] — Results per page (max 100)
 * @param   {string} [opts.sort='updated'] — Sort: created, updated, pushed, full_name
 * @param   {string} [opts.type='all'] — all, owner, public, private, member
 * @returns {Promise<Array<{
 *   id: number,
 *   name: string,
 *   full_name: string,
 *   private: boolean,
 *   html_url: string,
 *   clone_url: string,
 *   default_branch: string,
 *   description: string|null,
 *   language: string|null,
 *   updated_at: string,
 * }>>}
 */
export async function listUserRepos(token, opts = {}) {
  const {
    perPage = 100,
    sort = 'updated',
    type = 'all',
  } = opts;

  const url = new URL(`${GITHUB_API}/user/repos`);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('sort', sort);
  url.searchParams.set('type', type);

  const res = await fetch(url.toString(), {
    headers: headers(token),
    // Next.js: don't cache user-specific data
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitHub API error ${res.status}: ${body.slice(0, 200)}`
    );
  }

  const repos = await res.json();

  // Return a clean, slim shape
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    private: r.private,
    html_url: r.html_url,
    clone_url: r.clone_url,
    default_branch: r.default_branch,
    description: r.description || null,
    language: r.language || null,
    updated_at: r.updated_at,
  }));
}

/**
 * List branches for a specific repository.
 *
 * @param   {string} token — GitHub PAT
 * @param   {string} owner — Repository owner (user or org)
 * @param   {string} repo  — Repository name
 * @returns {Promise<Array<{
 *   name: string,
 *   protected: boolean,
 * }>>}
 */
export async function listBranches(token, owner, repo) {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;

  const res = await fetch(url, {
    headers: headers(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `GitHub API error ${res.status}: ${body.slice(0, 200)}`
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
 * @param   {string} token — GitHub PAT
 * @returns {Promise<{ login: string, name: string|null, avatar_url: string }>}
 */
export async function getAuthenticatedUser(token) {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: headers(token),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}`);
  }

  const user = await res.json();
  return {
    login: user.login,
    name: user.name || null,
    avatar_url: user.avatar_url,
  };
}
