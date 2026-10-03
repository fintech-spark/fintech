import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Merchant Brain.",
};

export default function LoginPage() {
  return <LoginForm />;
}
