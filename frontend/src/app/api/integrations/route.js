// ─────────────────────────────────────────────────────────
//  Lucid AI — Integrations API Route
//  Secure GitHub/GitLab token management
//
//  POST /api/integrations  → Connect a new integration
//  GET  /api/integrations  → List connected integrations
// ─────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/crypto';
import { validateToken } from '@/lib/integrations/validate';

// ═══════════════════════════════════════════════════════════
//  POST — Connect a new GitHub/GitLab integration
// ═══════════════════════════════════════════════════════════
//
//  Body: {
//    provider: "GITHUB" | "GITLAB",
//    token:    "ghp_abc123..." | "glpat-xyz...",
//    label?:   "Personal GitHub"
//  }
//
//  Returns: { id, provider, label, createdAt }
//
//  Flow:
//    1. Authenticate user
//    2. Parse & validate request body
//    3. ★ Validate token against the provider's API ★
//    4. Encrypt the token (AES-256-CTR)
//    5. Save/update integration with status ACTIVE
//
//  Security:
//    - Token is validated BEFORE being saved
//    - Token is NEVER stored in plaintext
//    - Encrypted with AES-256-CTR before saving
//    - Only the IV and ciphertext are persisted
// ═══════════════════════════════════════════════════════════

export async function POST(request) {
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
    const orgId = session.user.orgId;

    // ── 2. Parse & Validate Body ───────────────────────
    const body = await request.json();
    const { provider, token, label } = body;

    if (!provider || !token) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, token' },
        { status: 400 }
      );
    }

    // Validate provider enum
    const validProviders = ['GITHUB', 'GITLAB'];
    const normalizedProvider = provider.toUpperCase();
    if (!validProviders.includes(normalizedProvider)) {
      return NextResponse.json(
        { error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate token format (basic sanity checks)
    if (typeof token !== 'string' || token.length < 10) {
      return NextResponse.json(
        { error: 'Token appears to be invalid (too short).' },
        { status: 400 }
      );
    }

    // ── 3. ★ Validate Token Against Provider API ───────
    //    This calls GitHub/GitLab to confirm the token
    //    is real, active, and has the right permissions.
    //    If invalid → reject immediately, DO NOT save.
    const validation = await validateToken(normalizedProvider, token);

    if (!validation.isValid) {
      console.warn(
        `⚠️  Token validation failed for ${normalizedProvider}:`,
        validation.error
      );
      return NextResponse.json(
        {
          error: validation.error || 'Token validation failed.',
          provider: normalizedProvider,
        },
        { status: 400 }
      );
    }

    console.log(
      `✅ Token validated for ${normalizedProvider} — user: ${validation.username}`
    );

    // ── 4. Encrypt the Token ───────────────────────────
    const { iv, content: encryptedToken } = encrypt(token);

    // ── 5. Check for Existing Integration ──────────────
    // Allow multiple integrations per provider if they have different labels
    const normalizedLabel = label?.trim() || null;

    const existing = await prisma.integration.findFirst({
      where: {
        userId,
        provider: normalizedProvider,
        label: normalizedLabel,
      },
    });

    // Provider details to persist alongside the token
    const providerDetails = {
      externalUsername: validation.username || null,
      ...(validation.scopes ? { scopes: validation.scopes } : {}),
    };

    let integration;

    if (existing) {
      // ── Update Existing ──────────────────────────────
      integration = await prisma.integration.update({
        where: { id: existing.id },
        data: {
          encryptedToken,
          iv,
          ...providerDetails,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          provider: true,
          label: true,
          externalUsername: true,
          scopes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } else {
      // ── Create New ───────────────────────────────────
      if (!orgId) {
        return NextResponse.json(
          { error: 'No organization found. Please create one first.' },
          { status: 400 }
        );
      }

      integration = await prisma.integration.create({
        data: {
          provider: normalizedProvider,
          label: normalizedLabel,
          encryptedToken,
          iv,
          ...providerDetails,
          userId,
          orgId,
        },
        select: {
          id: true,
          provider: true,
          label: true,
          externalUsername: true,
          scopes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    return NextResponse.json({
      success: true,
      integration,
      message: existing
        ? `${normalizedProvider} integration updated successfully. Connected as ${validation.username}.`
        : `${normalizedProvider} integration connected successfully. Connected as ${validation.username}.`,
    }, { status: existing ? 200 : 201 });

  } catch (error) {
    console.error('❌ POST /api/integrations error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}


// ═══════════════════════════════════════════════════════════
//  GET — List all connected integrations
// ═══════════════════════════════════════════════════════════
//
//  Returns: {
//    integrations: [
//      { id, provider, label, externalUsername, createdAt, updatedAt },
//      ...
//    ]
//  }
//
//  Security:
//    - NEVER returns the encrypted token or IV
//    - Only shows metadata visible to the user
// ═══════════════════════════════════════════════════════════

export async function GET() {
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

    // ── 2. Fetch Integrations ──────────────────────────
    const integrations = await prisma.integration.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        label: true,
        externalUsername: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        // ⛔ NEVER select encryptedToken or iv
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ integrations });

  } catch (error) {
    console.error('❌ GET /api/integrations error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}


// ═══════════════════════════════════════════════════════════
//  DELETE — Disconnect an integration
// ═══════════════════════════════════════════════════════════
//
//  Query: ?id=<integration-id>
//
//  Security:
//    - Only the owner can delete their integration
//    - Cascades: Projects referencing this integration get
//      their integrationId set to null (onDelete: SetNull)
// ═══════════════════════════════════════════════════════════

export async function DELETE(request) {
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
    const { searchParams } = new URL(request.url);
    const integrationId = searchParams.get('id');

    if (!integrationId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: id' },
        { status: 400 }
      );
    }

    // ── 2. Verify Ownership ────────────────────────────
    const integration = await prisma.integration.findFirst({
      where: {
        id: integrationId,
        userId, // Only the owner can delete
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: 'Integration not found or access denied.' },
        { status: 404 }
      );
    }

    // ── 3. Delete ──────────────────────────────────────
    await prisma.integration.delete({
      where: { id: integrationId },
    });

    return NextResponse.json({
      success: true,
      message: `${integration.provider} integration disconnected.`,
    });

  } catch (error) {
    console.error('❌ DELETE /api/integrations error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
