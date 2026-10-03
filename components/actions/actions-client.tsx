"use client";

import * as React from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Clock,
  AlertTriangle,
  UserCheck,
  FileText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { approveActionForMerchant, executeActionForMerchant } from "@/app/(dashboard)/actions/actions";
import type { WireAction } from "@/lib/api/contracts";

interface ActionsClientProps {
  readonly businessId: string;
  readonly initialActions: readonly WireAction[];
}

export function ActionsClient({ businessId, initialActions }: ActionsClientProps) {
  const [actions, setActions] = React.useState<readonly WireAction[]>(initialActions);
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ message: string; isError?: boolean } | null>(null);

  const handleApprove = async (actionId: string) => {
    setProcessingId(actionId);
    setFeedback(null);
    const result = await approveActionForMerchant(businessId, actionId);
    if (result.outcome === "confirmed") {
      setActions((prev) => prev.map((a) => (a.id === actionId ? result.action : a)));
      setFeedback({ message: "Action approved successfully. Ready for execution." });
    } else {
      setFeedback({
        message: result.message,
        isError: true,
      });
    }
    setProcessingId(null);
  };

  const handleExecute = async (actionId: string) => {
    setProcessingId(actionId);
    setFeedback(null);
    const result = await executeActionForMerchant(businessId, actionId);
    if (result.outcome === "confirmed") {
      setActions((prev) => prev.map((a) => (a.id === actionId ? result.action : a)));
      setFeedback({ message: "Action executed successfully. Audit trail logged." });
    } else {
      setFeedback({
        message: result.message,
        isError: true,
      });
    }
    setProcessingId(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "proposed":
        return (
          <Badge variant="outline" className="border-caution-border bg-caution-subtle text-caution-foreground">
            <Clock className="size-3 mr-1" /> Pending Approval
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="border-info-border bg-info-subtle text-info-foreground">
            <UserCheck className="size-3 mr-1" /> Approved
          </Badge>
        );
      case "executing":
        return (
          <Badge variant="outline" className="border-pending-border bg-pending-subtle text-pending-foreground">
            <Spinner className="size-3 mr-1" /> Executing
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="border-positive-border bg-positive-subtle text-positive-foreground">
            <CheckCircle2 className="size-3 mr-1" /> Completed
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
            <XCircle className="size-3 mr-1" /> Rejected
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <AlertTriangle className="size-3 mr-1" /> Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <RotateCcw className="size-3 mr-1" /> {status}
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Dual-Approval Policy Notice */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <CardTitle className="text-base font-semibold">Strict Dual-Approval Policy Active</CardTitle>
          </div>
          <CardDescription>
            Consequential financial actions require two distinct user accounts (proposer and approver).
            Every approved action creates an immutable cryptographic audit record.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Operation Feedback */}
      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
            feedback.isError
              ? "border border-destructive/20 bg-destructive/10 text-destructive"
              : "border border-positive-border bg-positive-subtle text-positive-foreground"
          }`}
        >
          {feedback.isError ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Action List */}
      {actions.length === 0 ? (
        <Card className="border-dashed border-border py-12 text-center">
          <CardHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
              <ClipboardCheck className="size-6 text-muted-foreground" />
            </div>
            <CardTitle className="mt-3 text-base">No Actions Pending</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              Prepared actions will appear here when generated from Business Brain recommendations,
              profit leak investigations, or simulator scenarios.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/business-brain">Ask Business Brain</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {actions.map((action) => (
            <Card key={action.id} className="border-border bg-card shadow-xs">
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">
                      {action.title || action.type.replace(/_/g, " ").toUpperCase()}
                    </CardTitle>
                    {getStatusBadge(action.status)}
                  </div>
                  <CardDescription className="mt-1">
                    {action.description}
                  </CardDescription>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>Source: {action.source.replace(/_/g, " ")}</p>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {/* Controls */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                  {action.status.toLowerCase() === "proposed" && (
                    <Button
                      size="sm"
                      onClick={() => handleApprove(action.id)}
                      disabled={processingId === action.id}
                    >
                      {processingId === action.id ? (
                        <Spinner className="size-3.5 mr-1" />
                      ) : (
                        <CheckCircle2 className="size-3.5 mr-1" />
                      )}
                      Approve Action
                    </Button>
                  )}

                  {action.status.toLowerCase() === "approved" && (
                    <Button
                      size="sm"
                      onClick={() => handleExecute(action.id)}
                      disabled={processingId === action.id}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {processingId === action.id ? (
                        <Spinner className="size-3.5 mr-1" />
                      ) : (
                        <Play className="size-3.5 mr-1" />
                      )}
                      Execute Action
                    </Button>
                  )}

                  {action.status.toLowerCase() === "completed" && (
                    <div className="flex items-center gap-1.5 text-xs text-positive-foreground font-medium">
                      <FileText className="size-3.5" />
                      <span>Executed and Audited</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
