"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function ExpenseApproveEntryPage() {
  const router = useRouter();
  const [id, setId] = useState("");

  function go() {
    const trimmed = id.trim();
    if (trimmed) router.push(`/expenses/approve/${encodeURIComponent(trimmed)}`);
  }

  return (
    <>
      <PageHeader
        title="Approve expense"
        description="Enter an expense ID to confirm approval. The server must confirm before anything is shown as approved."
        toolbar={
          <Link
            href="/expenses"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All expenses
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expense ID</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") go(); }}
              placeholder="Expense ID"
                  className="min-w-64"
            />
            <Button onClick={go}>
              <Receipt aria-hidden="true" className="size-4" /> Open
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This screen only opens the expense for approval. The confirmation
            happens only after the server responds.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
