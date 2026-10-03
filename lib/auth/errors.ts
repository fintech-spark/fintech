// Merchant Brain: auth-specific application errors
//
// A failure *inside* the auth server (network, outage, unexpected response) is
// not a client mistake and not a 401 — reporting it as one would tell a user
// their password is wrong when the service is down. It is a 502 with a message
// that says nothing about the upstream provider.
//
// Deliberately its own class rather than a `DatabaseError`: no database was
// involved, and a 500 with a database label sends triage in the wrong
// direction.

import { AppError } from '@/lib/errors';

export class AuthProviderError extends AppError {
  readonly code = 'AUTH_PROVIDER_ERROR';
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
  }
}
