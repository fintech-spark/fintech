"use client";

// Merchant Brain: sign-up form.
//
// Three outcomes, all rendered explicitly:
//   - account created and confirmed → straight into the product;
//   - confirmation email sent → told to check their inbox, with the sign-in
//     link right there, so the flow does not dead-end;
//   - anything else → the server's own message.

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import {
  MIN_PASSWORD_LENGTH,
  signupSchema,
  type SignupInput,
} from "@/lib/auth/schemas";
import { postAuthRequest, type SignupResponseData } from "@/lib/auth/api-client";
import { APP_NAME } from "@/components/layout/nav-config";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupInput) {
    if (isSubmitting) return;
    setFormError(null);
    const result = await postAuthRequest<SignupResponseData>("/api/auth/signup", values);

    if (!result.ok) {
      setFormError(result.message ?? "Could not create the account. Please try again.");
      return;
    }

    if (result.data?.needsEmailConfirmation) {
      setConfirmationSent(true);
      return;
    }

    const redirectParam = searchParams.get("redirect") || searchParams.get("next");
    const target =
      redirectParam &&
      redirectParam.startsWith("/") &&
      !redirectParam.startsWith("//") &&
      !redirectParam.startsWith("/\\") &&
      !redirectParam.includes("://")
        ? redirectParam
        : "/overview";

    router.push(target);
    router.refresh();
  }

  if (confirmationSent) {
    return (
      <Card>
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="inline-flex items-center gap-2 text-xl">
            <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-medium tracking-tight">Check your email</h1>
          </CardTitle>
          <CardDescription>
            We sent a confirmation link to your address. Open it, then sign in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="text-xl">
          <h1 className="text-xl font-medium tracking-tight">Create your account</h1>
        </CardTitle>
        <CardDescription>
          Start with {APP_NAME}. You can add your business after signing in.
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
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Ravi Kumar"
              disabled={isSubmitting}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id="name-error" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              disabled={isSubmitting}
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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setShowPassword((current) => !current)}
                aria-pressed={showPassword}
                disabled={isSubmitting}
              >
                {showPassword ? "Hide" : "Show"}
              </Button>
            </div>
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              disabled={isSubmitting}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={
                errors.password ? "password-hint password-error" : "password-hint"
              }
              {...register("password")}
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters. Longer is stronger.
            </p>
            {errors.password ? (
              <p id="password-error" className="text-sm text-destructive">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>

        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
