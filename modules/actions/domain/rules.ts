import type { ActionStatus } from './types';
import { ACTION_STATUS_TRANSITIONS } from './types';
export function canTransitionActionTo(current: ActionStatus, next: ActionStatus): boolean { return ACTION_STATUS_TRANSITIONS[current].includes(next); }
export function requiresApproval(status: ActionStatus): boolean { return status === 'awaiting_approval'; }
export function canCancel(status: ActionStatus): boolean { return ['proposed', 'drafted', 'awaiting_approval'].includes(status); }
export function canRetryAction(status: ActionStatus): boolean { return status === 'failed'; }
