// ─────────────────────────────────────────────────────────
//  Lucid AI — Projects API Route
//  POST /api/projects → Create a new project
//  GET  /api/projects → List projects for current org
// ─────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

/**
 * POST /api/projects
 *
 * Body: {
 *   name:          string   — Project name
 *   repoUrl:       string   — Repository URL (html_url)
 *   integrationId: string   — Which integration token to use
 *   branch:        string   — Selected branch (default: "main")
 *   provider?:     string   — "GITHUB" | "GITLAB"
 * }
 */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const orgId = session.user.orgId;
    if (!orgId) {
      return NextResponse.json(
        { error: 'No organization found. Please create one first.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, repoUrl, integrationId, branch, provider } = body;

    if (!name || !repoUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: name, repoUrl' },
        { status: 400 }
      );
    }

    // Verify integration ownership if provided
    if (integrationId) {
      const integration = await prisma.integration.findFirst({
        where: { id: integrationId, userId: session.user.id },
        select: { id: true },
      });
      if (!integration) {
        return NextResponse.json(
          { error: 'Integration not found or access denied.' },
          { status: 404 }
        );
      }
    }

    const project = await prisma.project.create({
      data: {
        name,
        repoUrl,
        branch: branch || 'main',
        provider: provider || null,
        integrationId: integrationId || null,
        orgId,
      },
      select: {
        id: true,
        name: true,
        repoUrl: true,
        branch: true,
        provider: true,
        integrationId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, project }, { status: 201 });

  } catch (error) {
    console.error('❌ POST /api/projects error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects
 * Lists all projects for the current org.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const orgId = session.user.orgId;
    if (!orgId) {
      return NextResponse.json({ projects: [] });
    }

    const projects = await prisma.project.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        repoUrl: true,
        branch: true,
        provider: true,
        isActive: true,
        integrationId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ projects });

  } catch (error) {
    console.error('❌ GET /api/projects error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
