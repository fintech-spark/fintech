import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ErrorPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getBusiness } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";
import { describeStatus, BUSINESS_STATUS, USER_ROLE } from "@/lib/format/status";
import { BUSINESS_TYPE_LABEL } from "@/lib/format/labels";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const businessRequest = settle(getBusiness(businessId));
  const [business] = await Promise.all([businessRequest]);

  if (!business.ok) {
    // A 404 here means the record is gone or belongs to another business.
    if (business.error.isNotFound) notFound();
    return <ErrorPanel error={business.error} variant="card" />;
  }

  const profile = business.value.profile;
  const settings = business.value.settings;
  const members = context.members.filter((member) => member.status === "active");
  const currentMember = members.find(
    (m) => m.userId === context.session.userId,
  );
  const canInvite =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Business settings"
        description="Your business profile, the rules Merchant Brain applies, and who has access."
        toolbar={<FreshnessLine updatedAt={business.value.updatedAt} prefix="Settings last changed" />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardHeading>Business</CardHeading>
            <CardDescription>
              How this business appears on every screen. Details come from your
              own records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Row label="Name">{safeLabel(business.value.name)}</Row>
              <Row label="Trading name">{safeLabel(profile.displayName)}</Row>
              <Row label="Type">
                {BUSINESS_TYPE_LABEL[business.value.type] ?? business.value.type}
              </Row>
              <Row label="Status">
                <StatusBadge
                  descriptor={describeStatus(BUSINESS_STATUS, business.value.status)}
                  showIcon={false}
                  size="sm"
                />
              </Row>
              <Separator />
              <Row label="Industry">{safeLabel(profile.industry)}</Row>
              <Row label="Phone">{safeLabel(profile.phone)}</Row>
              <Row label="Email">{safeLabel(profile.email)}</Row>
              <Row label="Address">{safeLabel(profile.address)}</Row>
              <Row label="GSTIN">{safeLabel(profile.gstin)}</Row>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Editing this profile is a backend capability. No editable form is
              shown here, because a form that cannot save anything would be a
              broken control rather than an honest limit.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardHeading>Rules Merchant Brain applies</CardHeading>
            <CardDescription>
              These thresholds decide what gets flagged as low stock or overdue.
              They come from your business settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Row label="Currency">{settings.currency}</Row>
              <Row label="Low-stock threshold">
                {settings.lowStockThreshold} units
              </Row>
              <Row label="Overdue threshold">
                {settings.overdueThresholdDays} days past the due date
              </Row>
              <Row label="Financial year starts">
                Month {settings.fiscalYearStart}
              </Row>
              <Row label="Time zone">{settings.timezone}</Row>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              These explain why a product or a balance was flagged. Changing them
              changes what gets flagged, so they are shown rather than buried.
            </p>
          </CardContent>
        </Card>
      </div>

      <section id="team" aria-labelledby="team-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="team-heading"
          title="Who has access"
          description="Everyone who can see this business's records, and what they are allowed to do."
        />
        <Card>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team members could be loaded. If you are the only person using
                Merchant Brain, that is expected.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {members.map((member) => (
                  <li
                    key={`${member.businessId}-${member.userId}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {member.userId === context.session.userId
                          ? "You"
                          : "Team member"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Joined {formatDate(member.joinedAt)}
                      </span>
                    </span>
                    <Badge variant="secondary">
                      {describeStatus(USER_ROLE, member.role).label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              {canInvite ? (
                <>
                  <Button variant="link" size="sm" className="h-auto p-0">
                    Invite someone
                  </Button>{" "}
                  Inviting is available to owners and admins. The backend
                  invite endpoint is not fully connected yet, so this will
                  confirm with the server when submitted.
                </>
              ) : (
                <span>
                  Only owners and admins can invite team members. You are{" "}
                  {describeStatus(USER_ROLE, currentMember?.role ?? "staff").label}.
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="privacy-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="privacy-heading"
          title="How your data is handled"
          description="The short version, without the technical detail."
        />
        <Card>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm">
              <PrivacyPoint title="Your records stay in your business">
                Every request is checked against your session on the server. Moving
                between businesses in the sidebar changes what is loaded; it cannot
                give you access you did not already have.
              </PrivacyPoint>
              <PrivacyPoint title="Nothing irreversible happens without you">
                Confirming a document or approving an action is always an explicit
                step you take. Merchant Brain never does it on its own.
              </PrivacyPoint>
              <PrivacyPoint title="Figures are calculated, not guessed">
                Money, totals, stock levels and dates come from your records.
                Explanations are written separately and can be wrong — which is why
                every claim will carry its evidence.
              </PrivacyPoint>
            </ul>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

function PrivacyPoint({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1">
      <span className="font-medium">{title}</span>
      <span className="text-pretty text-muted-foreground">{children}</span>
    </li>
  );
}