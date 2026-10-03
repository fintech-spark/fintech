import { AppShell } from "@/components/layout/app-shell";

// Every merchant screen renders inside the same shell, so business identity,
// navigation and tenant context are guaranteed to be present on all of them.

export default function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}