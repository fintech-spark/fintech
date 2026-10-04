import { z } from "zod";

const sourceId = z.string().min(1);

export const EvidenceRefSchema = z.object({
  sourceId,
  recordId: z.string().min(1),
  sourceType: z.enum(["invoice", "receipt", "expense", "order", "message", "transaction", "inventory", "unknown"]),
  field: z.string().min(1).optional(),
  excerpt: z.string().min(1).optional(),
  observedAt: z.string().min(1).optional(),
}).strict();

export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});

export const InvoiceExtractionSchema = z.object({
  invoiceNumber: z.string().min(1).nullable(),
  issueDate: z.string().min(1).nullable(),
  dueDate: z.string().min(1).nullable(),
  supplierName: z.string().min(1).nullable(),
  lineItems: z.array(
    z.object({
      description: z.string().min(1),
      quantity: z.number().positive().nullable(),
      unitPrice: MoneySchema.nullable(),
      total: MoneySchema.nullable(),
    }),
  ),
  total: MoneySchema.nullable(),
  evidence: z.array(EvidenceRefSchema),
  needsReview: z.boolean(),
  uncertaintyReasons: z.array(z.string().min(1)),
});

export const ExpenseExtractionSchema = z.object({
  description: z.string().min(1).nullable(),
  amount: MoneySchema.nullable(),
  occurredOn: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  merchant: z.string().min(1).nullable(),
  evidence: z.array(EvidenceRefSchema),
  needsReview: z.boolean(),
});

export const OrderExtractionSchema = z.object({
  customerName: z.string().min(1).nullable(),
  orderedOn: z.string().min(1).nullable(),
  items: z.array(
    z.object({
      productName: z.string().min(1),
      quantity: z.number().positive().nullable(),
    }),
  ),
  total: MoneySchema.nullable(),
  paymentStatus: z.enum(["paid", "unpaid", "partial", "unknown"]),
  evidence: z.array(EvidenceRefSchema),
  needsReview: z.boolean(),
});

export const InsightSchema = z.object({
  claim: z.string().min(1),
  claimType: z.enum(["fact", "calculation", "interpretation", "recommendation", "draft"]),
  explanation: z.string().min(1),
  impact: MoneySchema.nullable(),
  confidence: z.enum(["high", "medium", "low", "insufficient_evidence"]),
  evidence: z.array(EvidenceRefSchema),
  conflicts: z.array(z.string().min(1)),
  freshness: z.string().min(1).nullable(),
  requiresReview: z.boolean(),
});

export const ProfitLeakSchema = InsightSchema.extend({
  leakType: z.enum(["margin", "waste", "pricing", "uncollected", "inventory", "unknown"]),
  affectedRecords: z.array(sourceId),
});

export const CashFlowRiskSchema = InsightSchema.extend({
  riskWindow: z.string().min(1).nullable(),
  affectedRecords: z.array(sourceId),
});

export const ScenarioResultSchema = z.object({
  scenarioName: z.string().min(1),
  assumptions: z.array(z.string().min(1)),
  outcomes: z.array(
    z.object({
      label: z.string().min(1),
      value: MoneySchema.nullable(),
      explanation: z.string().min(1),
    }),
  ),
  evidence: z.array(EvidenceRefSchema),
  requiresReview: z.boolean(),
});

export const ActionSchema = z.object({
  actionType: z.enum(["read", "prepare", "execute"]),
  title: z.string().min(1),
  draft: z.string().nullable(),
  affectedRecords: z.array(sourceId),
  evidence: z.array(EvidenceRefSchema),
  requiresConfirmation: z.boolean(),
  expiresAt: z.string().min(1).nullable(),
});

export const BusinessAnswerSchema = z.object({
  answer: z.string().min(1),
  claimType: z.enum(["fact", "calculation", "interpretation", "recommendation"]),
  evidence: z.array(EvidenceRefSchema),
  missingInformation: z.array(z.string().min(1)),
  conflicts: z.array(z.string().min(1)),
  confidence: z.enum(["high", "medium", "low", "insufficient_evidence"]),
}).strict();

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type ExpenseExtraction = z.infer<typeof ExpenseExtractionSchema>;
export type OrderExtraction = z.infer<typeof OrderExtractionSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type ProfitLeak = z.infer<typeof ProfitLeakSchema>;
export type CashFlowRisk = z.infer<typeof CashFlowRiskSchema>;
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type BusinessAnswer = z.infer<typeof BusinessAnswerSchema>;
