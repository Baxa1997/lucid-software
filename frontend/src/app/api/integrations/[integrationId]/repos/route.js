// ─────────────────────────────────────────────────────────
//  Lucid AI — Repos API Route
//  GET /api/integrations/[integrationId]/repos
//
//  Decrypts the stored token and fetches repositories
//  from GitHub or GitLab based on the integration provider.
// ─────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { decryptFromDB } from '@/lib/crypto';
import { listUserRepos as githubListRepos } from '@/lib/github-service';
import { listUserProjects as gitlabListProjects } from '@/lib/gitlab-service';

/**
 * GET /api/integrations/[integrationId]/repos
 *
 * Fetches the list of repositories accessible by the integration's token.
 * The token is decrypted server-side and NEVER sent to the client.
 *
 * Response: {
 *   provider: "GITHUB" | "GITLAB",
 *   repos: [
 *     { id, name, full_name, private, html_url, clone_url, default_branch, ... },
 *     ...
 *   ]
 * }
 */
export async function GET(request, { params }) {
  try {
    // ── 1. Authenticate ────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { integrationId } = await params;

    if (!integrationId) {
      return NextResponse.json(
        { error: 'Missing integrationId parameter.' },
        { status: 400 }
      );
    }

    // ── 2. Look up the Integration ─────────────────────
    const integration = await prisma.integration.findFirst({
      where: {
        id: integrationId,
        userId, // Security: only the owner can access
      },
      select: {
        id: true,
        provider: true,
        encryptedToken: true,
        iv: true,
        label: true,
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: 'Integration not found or access denied.' },
        { status: 404 }
      );
    }

    // ── 3. Decrypt the Token ───────────────────────────
    let token;
    try {
      token = decryptFromDB(integration.encryptedToken, integration.iv);
    } catch (decryptError) {
      console.error('❌ Token decryption failed:', decryptError.message);
      return NextResponse.json(
        { error: 'Failed to decrypt integration token. The encryption key may have changed.' },
        { status: 500 }
      );
    }

    // ── 4. Fetch Repos Based on Provider ───────────────
    let repos;

    switch (integration.provider) {
      case 'GITHUB': {
        repos = await githubListRepos(token);
        break;
      }
      case 'GITLAB': {
        repos = await gitlabListProjects(token);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unsupported provider: ${integration.provider}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      provider: integration.provider,
      integrationId: integration.id,
      label: integration.label,
      repos,
    });

  } catch (error) {
    console.error('❌ GET /api/integrations/[id]/repos error:', error);

    // Surface API-specific errors nicely
    if (error.message?.includes('API error')) {
      return NextResponse.json(
        { error: error.message },
        { status: 502 } // Bad Gateway — upstream API failed
      );
    }

    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
