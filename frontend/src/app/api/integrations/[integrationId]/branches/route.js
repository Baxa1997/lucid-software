// ─────────────────────────────────────────────────────────
//  Lucid AI — Branches API Route
//  GET /api/integrations/[integrationId]/branches
//
//  Decrypts the stored token and fetches branch list
//  for a specific repository from GitHub or GitLab.
// ─────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { decryptFromDB } from '@/lib/crypto';
import { listBranches as githubListBranches } from '@/lib/github-service';
import { listBranches as gitlabListBranches } from '@/lib/gitlab-service';

/**
 * GET /api/integrations/[integrationId]/branches?repo=owner/repo
 * GET /api/integrations/[integrationId]/branches?projectId=12345
 *
 * For GitHub: requires `repo` query param (e.g. "octocat/hello-world")
 * For GitLab: requires `projectId` query param (numeric ID)
 *
 * Response: {
 *   provider: "GITHUB" | "GITLAB",
 *   branches: [
 *     { name: "main", protected: true },
 *     { name: "develop", protected: false },
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
    const { searchParams } = new URL(request.url);

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
        { error: 'Failed to decrypt integration token.' },
        { status: 500 }
      );
    }

    // ── 4. Fetch Branches Based on Provider ────────────
    let branches;

    switch (integration.provider) {
      case 'GITHUB': {
        // Expect ?repo=owner/repo  (e.g. "octocat/hello-world")
        const repo = searchParams.get('repo');
        if (!repo || !repo.includes('/')) {
          return NextResponse.json(
            { error: 'Missing or invalid `repo` query parameter. Expected format: owner/repo' },
            { status: 400 }
          );
        }

        const [owner, repoName] = repo.split('/');
        branches = await githubListBranches(token, owner, repoName);
        break;
      }

      case 'GITLAB': {
        // Expect ?projectId=12345  (numeric GitLab project ID)
        const projectId = searchParams.get('projectId');
        if (!projectId) {
          return NextResponse.json(
            { error: 'Missing `projectId` query parameter for GitLab.' },
            { status: 400 }
          );
        }

        branches = await gitlabListBranches(token, projectId);
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
      branches,
    });

  } catch (error) {
    console.error('❌ GET /api/integrations/[id]/branches error:', error);

    if (error.message?.includes('API error')) {
      return NextResponse.json(
        { error: error.message },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
