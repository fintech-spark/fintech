import type { Metadata } from "next";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Merchant Brain account.",
};

export default function SignupPage() {
  return <SignupForm />;
}
