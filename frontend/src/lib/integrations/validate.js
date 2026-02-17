// ─────────────────────────────────────────────────────────
//  Lucid AI — Token Validation for Git Providers
//
//  Validates that a PAT (Personal Access Token) is real
//  and has the required permissions before saving.
//
//  validateGitHubToken(token) → { isValid, username?, providerId?, error? }
//  validateGitLabToken(token) → { isValid, username?, providerId?, error? }
//  validateToken(provider, token) → dispatcher
// ─────────────────────────────────────────────────────────

/**
 * Validate a GitHub Personal Access Token.
 *
 * Calls GET https://api.github.com/user to verify:
 *   - The token is syntactically valid
 *   - The token has not been revoked
 *   - The token can read the authenticated user's profile
 *
 * @param  {string} token  - GitHub PAT (e.g. ghp_xxx or github_pat_xxx)
 * @return {Promise<{ isValid: boolean, username?: string, providerId?: number, scopes?: string, error?: string }>}
 */
export async function validateGitHubToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'LucidAI-Integration-Validator',
      },
    });

    if (response.ok) {
      const data = await response.json();

      // Extract granted scopes from the response headers
      const scopes = response.headers.get('x-oauth-scopes') || '';

      return {
        isValid: true,
        username: data.login,
        providerId: data.id,
        scopes,
      };
    }

    // ── Handle known error codes ──────────────────────
    if (response.status === 401) {
      return {
        isValid: false,
        error: 'Invalid GitHub token. The token may be expired or revoked.',
      };
    }

    if (response.status === 403) {
      return {
        isValid: false,
        error: 'GitHub token lacks required permissions (403 Forbidden).',
      };
    }

    // ── Unexpected status ─────────────────────────────
    return {
      isValid: false,
      error: `GitHub returned unexpected status ${response.status}.`,
    };
  } catch (err) {
    console.error('❌ GitHub token validation network error:', err.message);
    return {
      isValid: false,
      error: 'Could not reach GitHub API. Please check your network and try again.',
    };
  }
}

/**
 * Validate a GitLab Personal Access Token.
 *
 * Calls GET https://gitlab.com/api/v4/user to verify:
 *   - The token is syntactically valid
 *   - The token has not been revoked
 *   - The token can read the authenticated user's profile
 *
 * @param  {string} token  - GitLab PAT (e.g. glpat-xxx)
 * @return {Promise<{ isValid: boolean, username?: string, providerId?: number, error?: string }>}
 */
export async function validateGitLabToken(token) {
  try {
    const response = await fetch('https://gitlab.com/api/v4/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data = await response.json();

      return {
        isValid: true,
        username: data.username,
        providerId: data.id,
      };
    }

    // ── Handle known error codes ──────────────────────
    if (response.status === 401) {
      return {
        isValid: false,
        error: 'Invalid GitLab token. The token may be expired or revoked.',
      };
    }

    if (response.status === 403) {
      return {
        isValid: false,
        error: 'GitLab token lacks required permissions (403 Forbidden).',
      };
    }

    // ── Unexpected status ─────────────────────────────
    return {
      isValid: false,
      error: `GitLab returned unexpected status ${response.status}.`,
    };
  } catch (err) {
    console.error('❌ GitLab token validation network error:', err.message);
    return {
      isValid: false,
      error: 'Could not reach GitLab API. Please check your network and try again.',
    };
  }
}

/**
 * Unified dispatcher — validates a token for any supported provider.
 *
 * @param  {"GITHUB"|"GITLAB"} provider
 * @param  {string}            token
 * @return {Promise<{ isValid: boolean, username?: string, providerId?: number, scopes?: string, error?: string }>}
 */
export async function validateToken(provider, token) {
  switch (provider) {
    case 'GITHUB':
      return validateGitHubToken(token);
    case 'GITLAB':
      return validateGitLabToken(token);
    default:
      return {
        isValid: false,
        error: `Unsupported provider: ${provider}`,
      };
  }
}
