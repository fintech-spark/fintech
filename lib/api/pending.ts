// Merchant Brain: capabilities whose backend does not exist yet.
//
// This file is a deliberate, honest catalogue. Several screens in this product
// — analytics roll-ups, profit leaks, cash-flow forecasts, the simulator,
// Business Brain answers, actions and notifications — have NO approved API
// route. PRODUCT_SPEC.md explicitly excludes "fake dashboards, fake AI
// answers, or unverified business facts used to make a demo look complete", and
// AI_CONTEXT.md §10.1 forbids inventing endpoints to make a feature look
// complete.
//
// So the UI does not fake them. It names the gap, says who owns it, and gives
// the merchant something real to do instead. This file is the single place
// that knowledge lives, so the pages do not each invent their own wording and
// so a future agent can delete a capability by deleting one entry here plus
// the page that renders it.

/** Workstream that owns the missing backend, from AI_CONTEXT.md §8. */
export type CapabilityOwner =
  | "Intelligence + Automation"
  | "Backend + Database + Security"
  | "AI / ML";

export interface PendingCapability {
  /** Route name the product uses, for the report and for deep links later. */
  readonly route: string;
  /** What the merchant would call this part of the product. */
  readonly label: string;
  /** One sentence, in merchant language, explaining the current state. */
  readonly explanation: string;
  /** What the merchant can do instead, right now. */
  readonly alternative: string;
  readonly owner: CapabilityOwner;
  /** Where the product says this capability is planned. */
  readonly phase: string;
}

export const PENDING_CAPABILITIES = {
  analyticsOverview: {
    route: "/api/analytics/overview",
    label: "Business overview summary",
    explanation:
      "Revenue, profit and margin roll-ups need the analytics service, which is not connected yet. The overview below is built only from records that already exist.",
    alternative:
      "Open Sales, Inventory or Money owed to you to see the records these figures would be built from.",
    owner: "Intelligence + Automation",
    phase: "Phase 4",
  },
  salesLedger: {
    route: "/api/transactions",
    label: "Sales and transaction history",
    explanation:
      "There is no route for listing transactions yet, so a sales ledger cannot be shown. Individual transactions can still be opened by their reference.",
    alternative:
      "Use Customers and Suppliers to see who bought and who you paid, or open a transaction by its reference.",
    owner: "Backend + Database + Security",
    phase: "Phase 3",
  },
  expenseLedger: {
    route: "/api/expenses",
    label: "Expense ledger",
    explanation:
      "Expenses can be recorded, reviewed and approved, but there is no route for listing them yet, so a full expense ledger cannot be shown.",
    alternative:
      "Open an expense by its reference to review and approve it.",
    owner: "Backend + Database + Security",
    phase: "Phase 3",
  },
  profitLeaks: {
    route: "/api/profit-leaks",
    label: "Profit leak detection",
    explanation:
      "Profit leaks are found by deterministic rules and explained by the AI layer. Neither is connected to this app yet, so no leak is being reported here.",
    alternative:
      "Check supplier pricing and product margins for anything that looks wrong to you.",
    owner: "Intelligence + Automation",
    phase: "Phase 4",
  },
  cashFlow: {
    route: "/api/cash-flow",
    label: "Cash-flow forecast",
    explanation:
      "A cash-flow forecast has to combine balances, sales, receivables and payables through the cash-flow engine. That engine is not connected yet, so no forecast is shown.",
    alternative:
      "Look at Money owed to you and Money you owe for the inputs a forecast would use.",
    owner: "Intelligence + Automation",
    phase: "Phase 4",
  },
  simulator: {
    route: "/api/simulator",
    label: "What-if simulator",
    explanation:
      "The simulator must run the deterministic maths itself. That service is not connected yet, so no scenario can be calculated here.",
    alternative:
      "Review current prices and costs in Inventory and Suppliers before deciding on a change.",
    owner: "Intelligence + Automation",
    phase: "Phase 4",
  },
  businessBrain: {
    route: "/api/business-brain",
    label: "Business Brain answers",
    explanation:
      "Business Brain answers questions using tools that read your real business data. Those tools are not connected yet, so no answer can be generated.",
    alternative:
      "Use the questions on this page as a checklist when reviewing your records.",
    owner: "AI / ML",
    phase: "Phase 9",
  },
  actions: {
    route: "/api/actions",
    label: "Action Center",
    explanation:
      "Actions move through draft, approval, execution and audit on the server. That lifecycle is not connected yet, so nothing can be prepared or approved here.",
    alternative:
      "Confirm or reject extracted documents directly — that approval boundary is already live.",
    owner: "Intelligence + Automation",
    phase: "Phase 13",
  },
  notifications: {
    route: "/api/notifications",
    label: "Notifications",
    explanation:
      "Notifications are generated by the server from verified events. That service is not connected yet, so this list is empty by design rather than by accident.",
    alternative:
      "Check the Needs review filter on Documents for the items currently waiting on you.",
    owner: "Intelligence + Automation",
    phase: "Phase 4",
  },
  auditTrail: {
    route: "/api/audit",
    label: "Audit trail",
    explanation:
      "Every consequential change is recorded in an append-only audit log. That log is not exposed to this app yet.",
    alternative:
      "Documents you confirm or reject show their current state on the record itself.",
    owner: "Intelligence + Automation",
    phase: "Phase 13",
  },
  evidencePanel: {
    route: "/api/evidence",
    label: "Evidence behind a claim",
    explanation:
      "Evidence references point at the exact records behind a statement. The evidence service is not connected yet, so no claim in this app carries evidence yet.",
    alternative:
      "Every figure here links to the record it came from, which is the same discipline evidence will follow.",
    owner: "AI / ML",
    phase: "Phase 6",
  },
  documentUpload: {
    route: "/api/documents (binary upload)",
    label: "Sending a new document",
    explanation:
      "Documents can be listed, reviewed, confirmed and rejected, but the storage adapter that accepts the file itself is not built yet, so there is nothing to upload.",
    alternative:
      "Review and confirm the documents already in your list.",
    owner: "Backend + Database + Security",
    phase: "Phase 3",
  },
} as const satisfies Record<string, PendingCapability>;

export type PendingCapabilityKey = keyof typeof PENDING_CAPABILITIES;

export function pendingCapability(
  key: PendingCapabilityKey,
): PendingCapability {
  return PENDING_CAPABILITIES[key];
}

/**
 * Grouped list for the capability report. Used by the UI to explain a gap and
 * by the documentation generator, so the two can never drift apart.
 */
export function pendingCapabilitiesByOwner(): readonly {
  readonly owner: CapabilityOwner;
  readonly capabilities: readonly PendingCapability[];
}[] {
  const grouped = new Map<CapabilityOwner, PendingCapability[]>();
  for (const capability of Object.values(PENDING_CAPABILITIES)) {
    const bucket = grouped.get(capability.owner) ?? [];
    bucket.push(capability);
    grouped.set(capability.owner, bucket);
  }
  return [...grouped.entries()].map(([owner, capabilities]) => ({
    owner,
    capabilities,
  }));
}