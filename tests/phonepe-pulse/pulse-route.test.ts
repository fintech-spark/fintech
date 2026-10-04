import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/benchmarks/pulse/route';

const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Mock auth context
vi.mock('@/lib/http/auth-context', () => ({
  requireRequestContext: vi.fn(async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      const { AuthenticationError } = await import('@/lib/errors');
      throw new AuthenticationError('Authentication required.');
    }
    return {
      accessToken: 'valid-token',
      user: { userId: USER_ID, email: 'user@example.test', businessIds: [] },
      client: {},
    };
  }),
}));

const mockSummary = {
  period: { year: 2026, quarter: 2 },
  nationalMetrics: {
    transactionCount: 38664285691,
    transactionAmount: 45496453556876.69,
    registeredUsers: 711653262,
  },
  comparisons: {
    quarterOverQuarter: { current: 38664285691, previous: 36251699085, change: 2412586606, changePct: 6.66 },
    yearOverYear: { current: 38664285691, previous: 30000000000, change: 8664285691, changePct: 28.88 },
  },
  nationalTrend: [
    { year: 2026, quarter: 1, transactionCount: 36251699085 },
    { year: 2026, quarter: 2, transactionCount: 38664285691 },
  ],
  userGrowth: [
    { year: 2026, quarter: 2, registered: 711653262 },
  ],
  categoryBreakdown: [
    { category: 'retail', transactionCount: 24691181013, sharePct: 63.86 },
    { category: 'p2p', transactionCount: 11889781621, sharePct: 30.75 },
  ],
  topStates: [
    { name: 'maharashtra', parent: null, rank: null, count: 5064451991, amount: 5465176553156.58 },
  ],
};

vi.mock('@/lib/http/wiring', () => ({
  wireBenchmarks: vi.fn(() => ({
    pulse: {
      getBenchmarkSummary: vi.fn(async () => mockSummary),
    },
  })),
}));

describe('GET /api/benchmarks/pulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const request = new Request('http://localhost:3000/api/benchmarks/pulse');
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('rejects invalid year/quarter parameters with 400', async () => {
    const request = new Request('http://localhost:3000/api/benchmarks/pulse?year=abc&quarter=9', {
      headers: { authorization: 'Bearer valid-token' },
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toContain('Parameters "year" and "quarter" must be integers.');
  });

  it('returns pulse benchmark summary when authenticated', async () => {
    const request = new Request('http://localhost:3000/api/benchmarks/pulse', {
      headers: { authorization: 'Bearer valid-token' },
    });
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.period).toEqual({ year: 2026, quarter: 2 });
    expect(body.data.nationalMetrics.transactionCount).toBe(38664285691);
    expect(body.data.topStates[0].name).toBe('maharashtra');
  });
});
