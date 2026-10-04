import { describe, it, expect } from 'vitest';
import { handleApiRequest } from '@/tests/e2e/fixtures/router';
import { pulseBenchmarkSchema } from '@/lib/api/contracts';

describe('PhonePe Pulse End-to-End Fixtures & Contracts', () => {
  it('dispatches /api/benchmarks/pulse in the stub router and validates against schema', () => {
    const url = new URL('http://localhost:3000/api/benchmarks/pulse');
    const response = handleApiRequest('GET', url, 'default');

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.data).toBeDefined();

    // Validate with Zod pulseBenchmarkSchema
    const parsed = pulseBenchmarkSchema.safeParse(body.data);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.period).toEqual({ year: 2026, quarter: 2 });
      expect(parsed.data.nationalMetrics.transactionCount).toBe(38664285691);
      expect(parsed.data.topStates.length).toBeGreaterThan(0);
      expect(parsed.data.categoryBreakdown.length).toBeGreaterThan(0);
    }
  });

  it('handles unauthenticated scenario cleanly', () => {
    const url = new URL('http://localhost:3000/api/benchmarks/pulse');
    const response = handleApiRequest('GET', url, 'unauthenticated');

    expect(response.status).toBe(401);
  });
});
