import type { Metadata } from "next";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your Merchant Brain password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
