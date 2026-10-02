import { describe, it, expect } from 'vitest';
import {
  createBusinessSchema,
  createTransactionSchema,
  createTransactionItemSchema,
  createExpenseSchema,
  createProductSchema,
  createCustomerSchema,
  createSupplierSchema,
  uploadDocumentSchema,
  recordMovementSchema,
  proposeActionSchema,
  sendNotificationSchema,
  logAuditSchema,
} from '@/database/validation';

describe('Database Validation — Transaction Schemas', () => {
  const validItem = {
    productId: 'prod-001',
    quantity: 2,
    unitPrice: 10000,
    discount: 0,
    tax: 0,
  };

  const validTransaction = {
    type: 'sale',
    counterpartyType: 'customer',
    counterpartyId: 'cust-001',
    items: [validItem],
    paymentMethod: 'cash',
    transactionDate: '2026-10-01T10:00:00Z',
  };

  it('accepts a valid transaction', () => {
    const result = createTransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
  });

  it('rejects negative unit price', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      items: [{ ...validItem, unitPrice: -100 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero quantity', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      items: [{ ...validItem, quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer unit price', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      items: [{ ...validItem, unitPrice: 10.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty items array', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid transaction type', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('does not accept client-provided id or businessId', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      id: 'tx-001',
      businessId: 'biz-001',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty('id');
    expect(result.success && result.data).not.toHaveProperty('businessId');
  });

  it('accepts idempotency key', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransaction,
      idempotencyKey: 'idem-001',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data?.idempotencyKey).toBe('idem-001');
  });

  it('validates single item via createTransactionItemSchema', () => {
    const result = createTransactionItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
  });
});

describe('Database Validation — Expense Schemas', () => {
  const validExpense = {
    category: 'rent',
    amount: 2500000,
    currency: 'INR',
    description: 'Monthly office rent',
    expenseDate: '2026-10-01T00:00:00Z',
  };

  it('accepts a valid expense', () => {
    const result = createExpenseSchema.safeParse(validExpense);
    expect(result.success).toBe(true);
  });

  it('rejects non-integer amount', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      amount: 2500.50,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects recurring expense without frequency', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      isRecurring: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts recurring expense with frequency and next due date', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      isRecurring: true,
      recurringFrequency: 'monthly',
      recurringNextDueDate: '2026-11-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('Database Validation — Product Schemas', () => {
  const validProduct = {
    name: 'Test Product',
    unit: 'piece',
    costPrice: 8000,
    sellingPrice: 12000,
  };

  it('accepts a valid product', () => {
    const result = createProductSchema.safeParse(validProduct);
    expect(result.success).toBe(true);
  });

  it('rejects negative cost price', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      costPrice: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative selling price', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      sellingPrice: -50,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid unit type', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      unit: 'invalid_unit',
    });
    expect(result.success).toBe(false);
  });

  it('defaults current_stock to 0', () => {
    const result = createProductSchema.safeParse(validProduct);
    expect(result.success && result.data?.currentStock).toBe(0);
  });
});

describe('Database Validation — Customer & Supplier Schemas', () => {
  it('accepts a valid customer', () => {
    const result = createCustomerSchema.safeParse({
      name: 'Test Customer',
      phone: '+919999999999',
    });
    expect(result.success).toBe(true);
  });

  it('rejects customer with empty name', () => {
    const result = createCustomerSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid customer email', () => {
    const result = createCustomerSchema.safeParse({
      name: 'Test',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid supplier', () => {
    const result = createSupplierSchema.safeParse({
      name: 'Test Supplier',
      contactName: 'Contact',
    });
    expect(result.success).toBe(true);
  });
});

describe('Database Validation — Document Schemas', () => {
  const validDoc = {
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    fileSize: 102400,
    sourceType: 'invoice',
  };

  it('accepts a valid document upload', () => {
    const result = uploadDocumentSchema.safeParse(validDoc);
    expect(result.success).toBe(true);
  });

  it('rejects file exceeding 50MB', () => {
    const result = uploadDocumentSchema.safeParse({
      ...validDoc,
      fileSize: 60 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source type', () => {
    const result = uploadDocumentSchema.safeParse({
      ...validDoc,
      sourceType: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('Database Validation — Action Schemas', () => {
  const validAction = {
    type: 'adjust_price',
    title: 'Reduce price of Product A',
    description: 'Price is above market average',
    source: 'profit_leak',
    parameters: { productId: 'prod-001', newPrice: 10000 },
  };

  it('accepts a valid action proposal', () => {
    const result = proposeActionSchema.safeParse(validAction);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = proposeActionSchema.safeParse({ type: 'custom' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source', () => {
    const result = proposeActionSchema.safeParse({
      ...validAction,
      source: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('Database Validation — Notification Schemas', () => {
  it('accepts a valid notification', () => {
    const result = sendNotificationSchema.safeParse({
      userId: 'user-001',
      type: 'low_stock_alert',
      title: 'Product A is low on stock',
      message: 'Only 5 units remaining',
      severity: 'warning',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = sendNotificationSchema.safeParse({
      userId: 'user-001',
      type: 'system',
      title: 'Test',
      message: 'Test message',
      severity: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('Database Validation — Audit Schema', () => {
  it('accepts a valid audit entry', () => {
    const result = logAuditSchema.safeParse({
      action: 'create',
      resourceType: 'transaction',
      resourceId: 'tx-001',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action type', () => {
    const result = logAuditSchema.safeParse({
      action: 'invalid',
      resourceType: 'transaction',
      resourceId: 'tx-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty resource_id', () => {
    const result = logAuditSchema.safeParse({
      action: 'create',
      resourceType: 'transaction',
      resourceId: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('Database Validation — Inventory Movement Schema', () => {
  const validMovement = {
    productId: 'prod-001',
    type: 'purchase',
    quantity: 10,
  };

  it('accepts a valid movement', () => {
    const result = recordMovementSchema.safeParse(validMovement);
    expect(result.success).toBe(true);
  });

  it('rejects zero or negative quantity', () => {
    expect(recordMovementSchema.safeParse({ ...validMovement, quantity: 0 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ ...validMovement, quantity: -5 }).success).toBe(false);
  });

  it('rejects invalid movement type', () => {
    const result = recordMovementSchema.safeParse({
      ...validMovement,
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('Database Validation — Business Schema', () => {
  it('accepts a valid business', () => {
    const result = createBusinessSchema.safeParse({
      name: 'My Store',
      type: 'retail',
    });
    expect(result.success).toBe(true);
  });

  it('defaults currency to INR', () => {
    const result = createBusinessSchema.safeParse({
      name: 'My Store',
      type: 'retail',
    });
    expect(result.success && result.data?.currency).toBe('INR');
  });

  it('rejects invalid business type', () => {
    const result = createBusinessSchema.safeParse({
      name: 'My Store',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});
