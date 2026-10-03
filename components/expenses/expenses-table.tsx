"use client";

import { useCallback, useState } from "react";
import { Receipt, Plus, Calendar, Tag, CheckCircle2 } from "lucide-react";
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
import type { WireExpense } from "@/lib/api/contracts";
import { formatDate } from "@/lib/format/dates";

const CATEGORY_OPTIONS = [
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "salaries", label: "Salaries" },
  { value: "supplies", label: "Supplies" },
  { value: "marketing", label: "Marketing" },
  { value: "transportation", label: "Transportation" },
  { value: "insurance", label: "Insurance" },
  { value: "maintenance", label: "Maintenance" },
  { value: "taxes", label: "Taxes" },
  { value: "fees", label: "Fees" },
  { value: "other", label: "Other" },
] as const;

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
] as const;

export function ExpensesTable({
  result,
  businessId,
}: {
  readonly result: Settled<Page<WireExpense>>;
  readonly businessId: string;
}) {
  const url = useUrlState();
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state
  const [expCategory, setExpCategory] = useState("supplies");
  const [amount, setAmount] = useState("250000"); // 2500.00
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const expenses = result.value;

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: expCategory,
          amount: parseInt(amount, 10) || 0,
          currency: "INR",
          description: description.trim() || `${expCategory} expense`,
          vendor: vendor.trim() || undefined,
          expenseDate: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Failed to record expense (${res.status})`);
      }
      setDialogOpen(false);
      window.location.reload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to record expense");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (expenseId: string) => {
    setApprovingId(expenseId);
    try {
      const res = await fetch(`/api/businesses/${businessId}/expenses/${expenseId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Failed to approve expense (${res.status})`);
      }
      window.location.reload();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to approve expense");
    } finally {
      setApprovingId(null);
    }
  };

  const columns: readonly DataColumn<WireExpense>[] = [
    {
      key: "date",
      header: "Date",
      cell: (exp) => (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="size-3.5" aria-hidden="true" />
          {formatDate(exp.expenseDate)}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (exp) => (
        <Badge variant="secondary" className="capitalize font-normal text-xs gap-1">
          <Tag className="size-3" aria-hidden="true" />
          {exp.category}
        </Badge>
      ),
    },
    {
      key: "description",
      header: "Description / Vendor",
      cell: (exp) => (
        <div className="flex flex-col">
          <span className="font-medium text-sm">{exp.description}</span>
          {exp.vendor && <span className="text-xs text-muted-foreground">Vendor: {exp.vendor}</span>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (exp) => (
        <Badge variant="outline" className="capitalize text-xs">
          {exp.status}
        </Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (exp) => (
        <span className="font-semibold tabular-nums text-foreground">
          <MoneyValue value={exp.amount} />
        </span>
      ),
    },
    {
      key: "actions",
      header: "Action",
      cell: (exp) =>
        exp.status === "pending" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={approvingId === exp.id}
            onClick={() => handleApprove(exp.id)}
            className="h-8 gap-1 text-xs"
          >
            <CheckCircle2 className="size-3.5 text-positive-foreground" aria-hidden="true" />
            <span>{approvingId === exp.id ? "Approving..." : "Approve"}</span>
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          selects={[
            {
              param: "category",
              label: "Category",
              options: CATEGORY_OPTIONS,
              allLabel: "All categories",
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
              <span>Record Expense</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record New Expense</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRecordExpense} className="flex flex-col gap-4 py-2">
              {errorMsg && (
                <p className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {errorMsg}
                </p>
              )}

              <div className="grid gap-2">
                <Label htmlFor="exp-cat">Category</Label>
                <Select value={expCategory} onValueChange={setExpCategory}>
                  <SelectTrigger id="exp-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="exp-amount">Amount (Minor Units / paise)</Label>
                <Input
                  id="exp-amount"
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="exp-desc">Description</Label>
                <Input
                  id="exp-desc"
                  placeholder="e.g. Monthly internet bill"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="exp-vendor">Vendor (Optional)</Label>
                <Input
                  id="exp-vendor"
                  placeholder="e.g. Airtel Business"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Recording..." : "Record Expense"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {expenses.items.length === 0 ? (
        <EmptyPanel
          icon={<Receipt className="size-8 text-muted-foreground" aria-hidden="true" />}
          title="No expenses found"
          description="There are no expenses recorded matching the selected filter criteria."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="size-4" aria-hidden="true" />
              <span>Record first expense</span>
            </Button>
          }
        />
      ) : (
        <TableFrame>
          <div className="hidden sm:block">
            <DataTable
              caption="Expense ledger"
              columns={columns}
              rows={expenses.items}
              rowKey={(exp) => exp.id}
            />
          </div>
          <div className="flex flex-col gap-2.5 sm:hidden p-2">
            {expenses.items.map((exp) => (
              <RecordCard
                key={exp.id}
                title={
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{exp.description}</span>
                    <MoneyValue value={exp.amount} />
                  </div>
                }
                subtitle={
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatDate(exp.expenseDate)}</span>
                    <span>•</span>
                    <span className="capitalize">{exp.category}</span>
                  </div>
                }
                status={
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize text-xs">
                      {exp.status}
                    </Badge>
                    {exp.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={approvingId === exp.id}
                        onClick={() => handleApprove(exp.id)}
                        className="h-7 text-xs"
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
          <TablePagination
            page={expenses}
            itemName="expense"
            onPageChange={setPage}
          />
        </TableFrame>
      )}
    </div>
  );
}
