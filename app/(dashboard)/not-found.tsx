import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { EmptyPanel } from "@/components/common/data-state";
import { Button } from "@/components/ui/button";

// A deep link that does not resolve, or a record that has been removed. The
// backend deliberately answers 404 for "gone" and "belongs to someone else"
// identically, so this page never speculates about which it was.

export default function DashboardNotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <EmptyPanel
        icon={<FileQuestion aria-hidden={true} className="size-5 text-muted-foreground" />}
        title="We could not find that"
        description="It may have been removed, or the link may be out of date. If you followed a link from inside Merchant Brain, the record it pointed at is no longer available to you."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/overview">Go to Overview</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/documents">See documents</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
