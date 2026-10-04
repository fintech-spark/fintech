// Merchant Brain: External APILayer integrations (Marketstack, Mailboxlayer, Countrylayer).
//
// These external services provide:
// 1. Mailboxlayer: email verification and deliverability scoring for merchants, customers, and suppliers.
// 2. Countrylayer: standardized country metadata, ISO codes, currencies, and dialing codes.
// 3. Marketstack: market and stock data feeds.
//
// Security & Architecture Invariants:
// - API keys are read from environment variables; never hardcoded in source control.
// - All outbound HTTP calls are protected with strict 5-second timeouts.
// - Upstream responses are validated with Zod contracts before use.
// - API errors from upstream are cleanly wrapped into typed AppErrors.

import { z } from 'zod';
import { AuthenticationError, ValidationError, AppError } from '@/lib/errors';

export class ExternalServiceError extends AppError {
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly statusCode = 502;
  constructor(public readonly service: string, message: string, details?: Record<string, unknown>) {
    super(`[${service}] ${message}`, details);
  }
}

// ── 1. Mailboxlayer (Email Verification) ────────────────────────────────────

export const mailboxlayerResponseSchema = z.object({
  email: z.string(),
  did_you_mean: z.string().optional().default(''),
  user: z.string().optional().default(''),
  domain: z.string().optional().default(''),
  format_valid: z.boolean(),
  mx_found: z.boolean().optional().default(false),
  smtp_check: z.boolean().optional().default(false),
  catch_all: z.boolean().nullable().optional(),
  role: z.boolean().optional().default(false),
  disposable: z.boolean().optional().default(false),
  free: z.boolean().optional().default(false),
  score: z.number().min(0).max(1).optional().default(0),
});

export type MailboxVerificationResult = z.infer<typeof mailboxlayerResponseSchema>;

export async function verifyEmailWithMailboxlayer(
  email: string,
  options?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<MailboxVerificationResult> {
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes('@')) {
    throw new ValidationError('Invalid email format provided for verification.');
  }

  const apiKey = options?.apiKey ?? process.env.MAILBOXLAYER_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError('Mailboxlayer', 'API key not configured in environment (MAILBOXLAYER_API_KEY).');
  }

  const fetcher = options?.fetchImpl ?? fetch;
  const url = `https://api.mailboxlayer.com/api/check?access_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(trimmed)}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (cause) {
    throw new ExternalServiceError('Mailboxlayer', 'Network request failed or timed out.', { cause: String(cause) });
  }

  const body = await response.json().catch(() => null);

  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: { code?: string | number; info?: string; message?: string } }).error;
    const msg = err.info ?? err.message ?? 'Mailboxlayer API rejected the request.';
    if (String(err.code) === '101' || String(err.code) === 'invalid_access_key') {
      throw new AuthenticationError(`Mailboxlayer access key is invalid or inactive: ${msg}`);
    }
    throw new ExternalServiceError('Mailboxlayer', msg, { code: err.code });
  }

  const parsed = mailboxlayerResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExternalServiceError('Mailboxlayer', 'Response did not match expected schema.', {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

// ── 2. Countrylayer (Country Metadata) ──────────────────────────────────────

export const countrylayerItemSchema = z.object({
  name: z.string(),
  topLevelDomain: z.array(z.string()).optional().default([]),
  alpha2Code: z.string(),
  alpha3Code: z.string(),
  callingCodes: z.array(z.string()).optional().default([]),
  capital: z.string().optional().default(''),
  region: z.string().optional().default(''),
  subregion: z.string().optional().default(''),
  population: z.number().optional().default(0),
  currencies: z
    .array(
      z.object({
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        symbol: z.string().nullable().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type CountryMetadata = z.infer<typeof countrylayerItemSchema>;

export async function getCountryWithCountrylayer(
  countryNameOrCode: string,
  options?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<CountryMetadata[]> {
  const query = countryNameOrCode.trim();
  if (!query) {
    throw new ValidationError('Country name or code must be provided.');
  }

  const apiKey = options?.apiKey ?? process.env.COUNTRYLAYER_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError('Countrylayer', 'API key not configured in environment (COUNTRYLAYER_API_KEY).');
  }

  const fetcher = options?.fetchImpl ?? fetch;
  const endpoint = query.length === 2 || query.length === 3 ? 'alpha' : 'name';
  const url = `http://api.countrylayer.com/v2/${endpoint}/${encodeURIComponent(query)}?access_key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (cause) {
    throw new ExternalServiceError('Countrylayer', 'Network request failed or timed out.', { cause: String(cause) });
  }

  const body = await response.json().catch(() => null);

  if (body && typeof body === 'object' && !Array.isArray(body) && 'error' in body) {
    const err = (body as { error: { code?: string | number; info?: string; message?: string } }).error;
    const msg = err.info ?? err.message ?? 'Countrylayer API rejected the request.';
    if (String(err.code) === '101' || String(err.code) === 'invalid_access_key') {
      throw new AuthenticationError(`Countrylayer access key is invalid or inactive: ${msg}`);
    }
    throw new ExternalServiceError('Countrylayer', msg, { code: err.code });
  }

  const rawArray = Array.isArray(body) ? body : body ? [body] : [];
  const parsed = z.array(countrylayerItemSchema).safeParse(rawArray);
  if (!parsed.success) {
    throw new ExternalServiceError('Countrylayer', 'Response did not match expected schema.', {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

// ── 3. Marketstack (Market End-Of-Day Data) ─────────────────────────────────

export const marketstackPointSchema = z.object({
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  symbol: z.string(),
  exchange: z.string().optional().default(''),
  date: z.string(),
});

export const marketstackResponseSchema = z.object({
  pagination: z
    .object({
      limit: z.number().optional().default(100),
      offset: z.number().optional().default(0),
      count: z.number().optional().default(0),
      total: z.number().optional().default(0),
    })
    .optional(),
  data: z.array(marketstackPointSchema).default([]),
});

export type MarketEndOfDayResult = z.infer<typeof marketstackResponseSchema>;

export async function getMarketEndOfDayWithMarketstack(
  symbols: string | string[],
  options?: { apiKey?: string; limit?: number; fetchImpl?: typeof fetch },
): Promise<MarketEndOfDayResult> {
  const symbolList = Array.isArray(symbols) ? symbols.map((s) => s.trim()).filter(Boolean) : [symbols.trim()];
  if (symbolList.length === 0 || !symbolList[0]) {
    throw new ValidationError('At least one ticker symbol must be provided.');
  }

  const apiKey = options?.apiKey ?? process.env.MARKETSTACK_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError('Marketstack', 'API key not configured in environment (MARKETSTACK_API_KEY).');
  }

  const fetcher = options?.fetchImpl ?? fetch;
  const limitParam = options?.limit ? `&limit=${Math.min(Math.max(options.limit, 1), 100)}` : '';
  const url = `http://api.marketstack.com/v1/eod?access_key=${encodeURIComponent(apiKey)}&symbols=${encodeURIComponent(symbolList.join(','))}${limitParam}`;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (cause) {
    throw new ExternalServiceError('Marketstack', 'Network request failed or timed out.', { cause: String(cause) });
  }

  const body = await response.json().catch(() => null);

  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: { code?: string | number; info?: string; message?: string } }).error;
    const msg = err.info ?? err.message ?? 'Marketstack API rejected the request.';
    if (String(err.code) === '101' || String(err.code) === 'invalid_access_key') {
      throw new AuthenticationError(`Marketstack access key is invalid or inactive: ${msg}`);
    }
    throw new ExternalServiceError('Marketstack', msg, { code: err.code });
  }

  const parsed = marketstackResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ExternalServiceError('Marketstack', 'Response did not match expected schema.', {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
