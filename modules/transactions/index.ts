export type { Transaction, TransactionType, TransactionStatus, TransactionItem, PaymentMethod } from './domain/types';
export { canTransitionTo, isModifiable, calculateItemTotal, validateTransactionTotal } from './domain/rules';
export type { TransactionService, CreateTransactionInput, TransactionFilters } from './application/service';
export type { TransactionRepository } from './infrastructure/repository';
