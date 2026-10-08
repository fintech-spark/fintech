"use client";

// Merchant Brain: forgot password form.
//
// Submits email address to initiate password reset.
// Always shows positive confirmation to prevent user enumeration.

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";

import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { postAuthRequest } from "@/lib/auth/api-client";
import { APP_NAME } from "@/components/layout/nav-config";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    const result = await postAuthRequest<{ sent: boolean }>("/api/auth/forgot-password", values);

    if (!result.ok && result.status !== 200) {
      setFormError(result.message ?? "Could not send password reset email. Please try again.");
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="inline-flex items-center gap-2 text-xl">
            <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-medium tracking-tight">Check your email</h1>
          </CardTitle>
          <CardDescription>
            If an account is associated with that email, we have sent instructions to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Button asChild className="w-full">
            <Link href="/login">Return to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="text-xl">
          <h1 className="text-xl font-medium tracking-tight">Reset your password</h1>
        </CardTitle>
        <CardDescription>
          Enter your email address and we will send you a link to reset your password for {APP_NAME}.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-5">
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-4"
          aria-busy={isSubmitting}
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email ? (
              <p id="email-error" className="text-sm text-destructive">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                Sending instructions…
              </>
            ) : (
              <>
                <Mail className="size-4 mr-2" aria-hidden="true" />
                Send reset link
              </>
            )}
          </Button>

          <Button variant="ghost" asChild className="w-full">
            <Link href="/login">
              <ArrowLeft className="size-4 mr-1.5" aria-hidden="true" />
              Back to sign in
            </Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
