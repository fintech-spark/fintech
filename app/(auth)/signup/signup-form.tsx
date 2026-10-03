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
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";

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
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignupInput) {
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

    router.push("/overview");
    router.refresh();
  }

  if (confirmationSent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-xl">
            <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
            Check your email
          </CardTitle>
          <CardDescription>
            We sent a confirmation link to your address. Open it, then sign in to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Start with {APP_NAME}. You can add your business after signing in.
        </CardDescription>
      </CardHeader>

      <CardContent>
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
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Ravi Kumar"
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
