// Merchant Brain: Unit and integration tests for Marketstack, Mailboxlayer, and Countrylayer.

import { describe, expect, it, vi } from 'vitest';
import {
  verifyEmailWithMailboxlayer,
  getCountryWithCountrylayer,
  getMarketEndOfDayWithMarketstack,
  ExternalServiceError,
} from '@/lib/integrations/apilayer';
import { AuthenticationError, ValidationError } from '@/lib/errors';

describe('APILayer External Integrations', () => {
  // ── 1. Mailboxlayer ────────────────────────────────────────────────────────
  describe('verifyEmailWithMailboxlayer', () => {
    it('throws ValidationError on invalid email format', async () => {
      await expect(verifyEmailWithMailboxlayer('invalid-email')).rejects.toThrow(ValidationError);
    });

    it('throws ExternalServiceError when API key is missing', async () => {
      const orig = process.env.MAILBOXLAYER_API_KEY;
      delete process.env.MAILBOXLAYER_API_KEY;
      try {
        await expect(verifyEmailWithMailboxlayer('test@example.com', { apiKey: '' })).rejects.toThrow(
          ExternalServiceError,
        );
      } finally {
        if (orig) process.env.MAILBOXLAYER_API_KEY = orig;
      }
    });

    it('parses valid email verification response successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          email: 'merchant@spice.in',
          did_you_mean: '',
          user: 'merchant',
          domain: 'spice.in',
          format_valid: true,
          mx_found: true,
          smtp_check: true,
          score: 0.85,
        }),
      });

      const result = await verifyEmailWithMailboxlayer('merchant@spice.in', {
        apiKey: 'test-key',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(result.email).toBe('merchant@spice.in');
      expect(result.format_valid).toBe(true);
      expect(result.score).toBe(0.85);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('translates upstream invalid_access_key error to AuthenticationError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          success: false,
          error: {
            code: 101,
            type: 'invalid_access_key',
            info: 'You have not supplied a valid API Access Key.',
          },
        }),
      });

      await expect(
        verifyEmailWithMailboxlayer('merchant@spice.in', {
          apiKey: 'bad-key',
          fetchImpl: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  // ── 2. Countrylayer ────────────────────────────────────────────────────────
  describe('getCountryWithCountrylayer', () => {
    it('throws ValidationError on empty country name', async () => {
      await expect(getCountryWithCountrylayer('')).rejects.toThrow(ValidationError);
    });

    it('parses valid country metadata response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => [
          {
            name: 'India',
            topLevelDomain: ['.in'],
            alpha2Code: 'IN',
            alpha3Code: 'IND',
            callingCodes: ['91'],
            capital: 'New Delhi',
            region: 'Asia',
            subregion: 'Southern Asia',
            population: 1380004385,
            currencies: [{ code: 'INR', name: 'Indian rupee', symbol: '₹' }],
          },
        ],
      });

      const countries = await getCountryWithCountrylayer('India', {
        apiKey: 'test-key',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(countries).toHaveLength(1);
      expect(countries[0].name).toBe('India');
      expect(countries[0].alpha2Code).toBe('IN');
      expect(countries[0].currencies[0].code).toBe('INR');
    });

    it('translates upstream invalid_access_key to AuthenticationError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          error: {
            code: 'invalid_access_key',
            message: 'You have not supplied a valid API Access Key.',
          },
        }),
      });

      await expect(
        getCountryWithCountrylayer('India', {
          apiKey: 'bad-key',
          fetchImpl: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  // ── 3. Marketstack ─────────────────────────────────────────────────────────
  describe('getMarketEndOfDayWithMarketstack', () => {
    it('throws ValidationError on empty symbols list', async () => {
      await expect(getMarketEndOfDayWithMarketstack([])).rejects.toThrow(ValidationError);
    });

    it('parses valid market data points', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          pagination: { limit: 100, offset: 0, count: 1, total: 1 },
          data: [
            {
              open: 180.5,
              high: 182.0,
              low: 179.0,
              close: 181.25,
              volume: 45000000,
              symbol: 'AAPL',
              exchange: 'XNAS',
              date: '2026-03-15T00:00:00+0000',
            },
          ],
        }),
      });

      const result = await getMarketEndOfDayWithMarketstack('AAPL', {
        apiKey: 'test-key',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].symbol).toBe('AAPL');
      expect(result.data[0].close).toBe(181.25);
    });

    it('translates upstream invalid_access_key to AuthenticationError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: async () => ({
          error: {
            code: 'invalid_access_key',
            message: 'You have not supplied a valid API Access Key.',
          },
        }),
      });

      await expect(
        getMarketEndOfDayWithMarketstack('AAPL', {
          apiKey: 'bad-key',
          fetchImpl: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(AuthenticationError);
    });
  });
});
