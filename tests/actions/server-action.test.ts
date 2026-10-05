import { describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/endpoints', () => ({ executeAction: execute, approveAction: vi.fn() }));
import { executeActionForMerchant } from '@/app/(dashboard)/actions/actions';

describe('action server mutation confirmation', () => {
  it('never treats an executed=false response as successful', async () => {
    execute.mockResolvedValue({ executed: false, action: { status: 'approved' } });
    expect(await executeActionForMerchant('synthetic-business', 'synthetic-action')).toMatchObject({ outcome: 'rejected', indeterminate: false });
  });
  it('shows an in-progress outcome as indeterminate', async () => {
    execute.mockResolvedValue({ executed: false, action: { status: 'executing' } });
    expect(await executeActionForMerchant('synthetic-business', 'synthetic-action')).toMatchObject({ outcome: 'rejected', indeterminate: true });
  });
  it('confirms only a completed successful execution', async () => {
    execute.mockResolvedValue({ executed: true, action: { status: 'completed' } });
    expect(await executeActionForMerchant('synthetic-business', 'synthetic-action')).toMatchObject({ outcome: 'confirmed', action: { status: 'completed' } });
  });
});
