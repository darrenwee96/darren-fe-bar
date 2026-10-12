// Who is calling? One place for it: scope and decision attribution both use `requireUser`.
//
// We do NOT trust x-forwarded-email / x-forwarded-user on their own. In a deployed app the Databricks Apps proxy
// forwards the signed-in user's OAuth token as x-forwarded-access-token (this app sets user_api_scopes, and the
// platform adds iam.current-user:read). The token is verified by calling SCIM /Me with it, and the identity the
// workspace returns is the identity we use. A forged email header without a matching token gets nowhere. Results are
// cached per token hash for a few minutes, so SCIM is not called on every request.
//
// Local development (NODE_ENV=development, no proxy, no token) uses DEV_USER_EMAIL, or 'local-developer'.
// Any other request without a verifiable identity is rejected with 401.

import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type TokenVerifier = (token: string) => Promise<string | null>;

export interface IdentityOptions {
  /** Resolves a user access token to the user's email, or null if the workspace rejects it. */
  verifyToken: TokenVerifier;
  /** Identity for requests without a token; only set in local development. */
  devUser: string | null;
  cacheTtlMs?: number;
}

export class IdentityError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function workspaceHost(): string | null {
  const host = process.env.DATABRICKS_HOST?.trim();
  if (!host) return null;
  return (host.startsWith('http') ? host : `https://${host}`).replace(/\/+$/, '');
}

/** Verify a user token against the workspace: SCIM /Me returns the token owner's userName (their email). */
export function scimVerifier(host = workspaceHost(), fetchFn: typeof fetch = fetch): TokenVerifier {
  return async (token) => {
    if (!host) throw new IdentityError('DATABRICKS_HOST is not set; cannot verify the user', 500);
    const res = await fetchFn(`${host}/api/2.0/preview/scim/v2/Me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new IdentityError(`Identity check failed (${res.status})`, 503);
    const me = (await res.json()) as { userName?: string; emails?: { value?: string; primary?: boolean }[] };
    return me.userName ?? me.emails?.find((e) => e.primary)?.value ?? me.emails?.[0]?.value ?? null;
  };
}

export function defaultIdentityOptions(): IdentityOptions {
  return {
    verifyToken: scimVerifier(),
    devUser: process.env.NODE_ENV === 'development' ? process.env.DEV_USER_EMAIL?.trim() || 'local-developer' : null,
  };
}

/** Build the identity resolver. Returns the verified email or throws IdentityError (401 / 5xx). */
export function createIdentityResolver({ verifyToken, devUser, cacheTtlMs = 5 * 60_000 }: IdentityOptions) {
  const cache = new Map<string, { email: string; expires: number }>();

  return async function resolveUser(req: Request): Promise<string> {
    const token = req.header('x-forwarded-access-token')?.trim();
    if (!token) {
      if (devUser) return devUser;
      throw new IdentityError('Sign-in required', 401);
    }
    const key = createHash('sha256').update(token).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.email;

    const email = await verifyToken(token);
    if (!email) throw new IdentityError('Your session could not be verified. Reload the page to sign in again.', 401);
    const claimed = req.header('x-forwarded-email');
    if (claimed && claimed.toLowerCase() !== email.toLowerCase()) {
      console.warn('[identity] x-forwarded-email does not match the verified token owner; using the verified identity');
    }
    if (cache.size > 1000) cache.clear();
    cache.set(key, { email, expires: Date.now() + cacheTtlMs });
    return email;
  };
}

/** Express middleware: sets res.locals.user to the verified email, or answers 401 / 5xx. */
export function requireUser(resolveUser: (req: Request) => Promise<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    resolveUser(req)
      .then((email) => {
        res.locals.user = email;
        next();
      })
      .catch((err: unknown) => {
        const status = err instanceof IdentityError ? err.status : 500;
        if (status >= 500) console.error('Identity check failed:', err);
        res.status(status).json({ error: err instanceof IdentityError ? err.message : 'Identity check failed' });
      });
  };
}
