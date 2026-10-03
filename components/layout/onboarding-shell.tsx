"use client";

// Merchant Brain: Onboarding Screen
//
// Displayed when an authenticated user has no businesses provisioned yet.
// Prompts the merchant to create their primary business profile to get started.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, LogOut, Sparkles } from "lucide-react";

import { APP_NAME } from "./nav-config";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WireSession } from "@/lib/api/contracts";

interface OnboardingShellProps {
  readonly session: WireSession;
}

const BUSINESS_TYPES = [
  { value: "retail", label: "Retail / Shop" },
  { value: "wholesale", label: "Wholesale / Distribution" },
  { value: "food_beverage", label: "Restaurant / Cafe / Food & Beverage" },
  { value: "manufacturing", label: "Manufacturing / Workshop" },
  { value: "services", label: "Services / Consulting" },
  { value: "other", label: "Other Business" },
] as const;

export function OnboardingShell({ session }: OnboardingShellProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("retail");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your business name.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          profile: { displayName: name.trim() },
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to create business. Please try again.");
      }

      // Business created successfully — navigate to the main dashboard
      router.push("/overview");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              MB
            </span>
            <div className="flex flex-col">
              <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
              <p className="text-xs text-muted-foreground">Setup &amp; Onboarding</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-xs text-muted-foreground"
          >
            <LogOut className="size-3.5 mr-1" aria-hidden="true" />
            Sign out
          </Button>
        </div>

        <Card className="border-border shadow-xs">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Welcome</span>
            </div>
            <CardTitle className="text-xl">Set up your business</CardTitle>
            <CardDescription className="text-pretty">
              You are signed in as <span className="font-medium text-foreground">{session.email}</span>.
              Create your business profile to begin tracking transactions, expenses, inventory, and insights.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="business-name">Business Name</Label>
                <Input
                  id="business-name"
                  type="text"
                  placeholder="e.g. Acme Stores, Singh Enterprises"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="business-type">Business Type</Label>
                <select
                  id="business-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  disabled={isSubmitting}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {BUSINESS_TYPES.map((bt) => (
                    <option key={bt.value} value={bt.value} className="bg-popover text-popover-foreground">
                      {bt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Standard Settings:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Currency: <span className="font-mono font-medium text-foreground">INR (₹)</span></li>
                  <li>Timezone: <span className="font-mono font-medium text-foreground">Asia/Kolkata</span></li>
                  <li>Role: <span className="font-medium text-foreground">Owner</span> (full administrative permissions)</li>
                </ul>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full mt-2">
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                    Creating your business…
                  </>
                ) : (
                  <>
                    <Building2 className="size-4 mr-2" aria-hidden="true" />
                    Create Business &amp; Get Started
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
