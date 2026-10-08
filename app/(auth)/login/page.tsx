import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { resolveMerchantContext } from "@/lib/api/context";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Merchant Brain.",
};

export default async function LoginPage() {
  const cookieJar = await cookies();
  const token = cookieJar.get(ACCESS_TOKEN_COOKIE)?.value?.trim();
  if (token) {
    const context = await resolveMerchantContext();
    if (context.status === "authenticated" || context.status === "onboarding") {
      redirect("/overview");
    }
  }

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
