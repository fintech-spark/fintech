"use client";

import { useCallback, useState } from "react";
import { ShoppingCart, Plus, Calendar, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { TablePagination } from "@/components/data/table-pagination";
import { FilterBar } from "@/components/data/filter-bar";
import { useUrlState } from "@/components/data/url-state";
import { ErrorPanel, EmptyPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Settled } from "@/lib/api/settle";
import type { Page } from "@/lib/api/client";
import type { WireTransaction } from "@/lib/api/contracts";
import { formatDate } from "@/lib/format/dates";

const TYPE_OPTIONS = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
  { value: "payment", label: "Payments" },
  { value: "refund", label: "Refunds" },
] as const;

const STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "draft", label: "Draft" },
  { value: "voided", label: "Voided" },
] as const;

export function TransactionsTable({
  result,
  businessId,
}: {
  readonly result: Settled<Page<WireTransaction>>;
  readonly businessId: string;
}) {
  const url = useUrlState();
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state for Record Sale dialog
  const [txnType, setTxnType] = useState<"sale" | "purchase">("sale");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card" | "bank_transfer">("upi");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("50000"); // 500.00 in minor units

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const transactions = result.value;

  const handleRecordSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionDate: new Date().toISOString(),
          type: txnType,
          counterpartyType: txnType === "sale" ? "customer" : "supplier",
          counterpartyId: counterpartyId || "00000000-0000-0000-0000-000000000000",
          paymentMethod,
          items: [
            {
              productId: productId || "00000000-0000-0000-0000-000000000001",
              quantity: Math.max(1, parseInt(quantity, 10) || 1),
              unitPrice: parseInt(unitPrice, 10) || 0,
              discount: 0,
              tax: 0,
            },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Failed to record transaction (${res.status})`);
      }

      setDialogOpen(false);
      window.location.reload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to record transaction");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: readonly DataColumn<WireTransaction>[] = [
    {
      key: "date",
      header: "Date",
      cell: (tx) => (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="size-3.5" aria-hidden="true" />
          {formatDate(tx.transactionDate)}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (tx) => {
        const isSale = tx.type === "sale";
        return (
          <div className="flex items-center gap-1.5 font-medium">
            {isSale ? (
              <ArrowDownLeft className="size-4 text-positive-foreground" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="size-4 text-caution-foreground" aria-hidden="true" />
            )}
            <span className="capitalize">{tx.type}</span>
          </div>
        );
      },
    },
    {
      key: "method",
      header: "Payment",
      cell: (tx) => (
        <Badge variant="outline" className="capitalize text-xs font-normal">
          {(tx.paymentMethod ?? "other").replace("_", " ")}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (tx) => (
        <Badge variant="outline" className="capitalize text-xs">
          {tx.status}
        </Badge>
      ),
    },
    {
      key: "items",
      header: "Items",
      cell: (tx) => (
        <span className="text-xs text-muted-foreground">
          {tx.items.length} {tx.items.length === 1 ? "line item" : "line items"}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      cell: (tx) => (
        <span className="font-semibold tabular-nums">
          <MoneyValue value={tx.total} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          selects={[
            {
              param: "type",
              label: "Type",
              options: TYPE_OPTIONS,
              allLabel: "All types",
            },
            {
              param: "status",
              label: "Status",
              options: STATUS_OPTIONS,
              allLabel: "All statuses",
            },
          ]}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" aria-hidden="true" />
              <span>Record Sale</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record New Sale</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRecordSale} className="flex flex-col gap-4 py-2">
              {errorMsg && (
                <p className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {errorMsg}
                </p>
              )}
              <div className="grid gap-2">
                <Label htmlFor="txn-type">Type</Label>
                <Select value={txnType} onValueChange={(v) => setTxnType(v as "sale" | "purchase")}>
                  <SelectTrigger id="txn-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sale">Sale</SelectItem>
                    <SelectItem value="purchase">Purchase</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="pay-method">Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as "cash" | "upi" | "card" | "bank_transfer")}
                >
                  <SelectTrigger id="pay-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="txn-product">Product ID (optional)</Label>
                  <Input
                    id="txn-product"
                    placeholder="Product UUID"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="txn-counterparty">Counterparty ID (optional)</Label>
                  <Input
                    id="txn-counterparty"
                    placeholder="Customer UUID"
                    value={counterpartyId}
                    onChange={(e) => setCounterpartyId(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="txn-qty">Quantity</Label>
                  <Input
                    id="txn-qty"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="txn-amount">Unit Price (Minor Units / paise)</Label>
                  <Input
                    id="txn-amount"
                    type="number"
                    min="0"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    required
                  />
                </div>
              </div>

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Recording..." : "Record Transaction"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {transactions.items.length === 0 ? (
        <EmptyPanel
          icon={<ShoppingCart className="size-8 text-muted-foreground" aria-hidden="true" />}
          title="No transactions found"
          description="There are no transactions recorded matching the selected filter criteria."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="size-4" aria-hidden="true" />
              <span>Record first sale</span>
            </Button>
          }
        />
      ) : (
        <TableFrame>
          <div className="hidden sm:block">
            <DataTable
              caption="Transactions ledger"
              columns={columns}
              rows={transactions.items}
              rowKey={(tx) => tx.id}
            />
          </div>
          <div className="flex flex-col gap-2.5 sm:hidden p-2">
            {transactions.items.map((tx) => (
              <RecordCard
                key={tx.id}
                title={
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold capitalize">{tx.type}</span>
                    <MoneyValue value={tx.total} />
                  </div>
                }
                subtitle={
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(tx.transactionDate)}</span>
                    <span>•</span>
                    <span className="capitalize">{tx.paymentMethod}</span>
                  </div>
                }
                status={
                  <Badge variant="outline" className="capitalize text-xs">
                    {tx.status}
                  </Badge>
                }
              />
            ))}
          </div>
          <TablePagination
            page={transactions}
            itemName="transaction"
            onPageChange={setPage}
          />
        </TableFrame>
      )}
    </div>
  );
}
