import type { Metadata } from "next";
import { BrainCircuit } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Ask Merchant Brain" };

const QUESTIONS = [
  "Why did my profit drop?",
  "Where am I losing money?",
  "Which customers owe me money?",
  "What inventory should I reorder?",
  "What happens if I raise prices?",
  "How is my cash flow looking?",
];

export default async function BusinessBrainPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("businessBrain")}
      icon={<BrainCircuit aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Ask Merchant Brain"
      description="Ask a question about your business in plain language and get an answer built from your own records."
      promise={[
        "An answer first, then the key numbers, then the evidence, then what to do next.",
        "Every claim linked to the records that support it, so you can check it.",
        "Honest uncertainty — limited history or missing costs stated plainly, never hidden.",
        "A recommended next step that can become a prepared action for you to approve.",
      ]}
      inputs={[
        { href: "/overview", label: "Your business overview" },
        { href: "/documents", label: "The documents behind your records" },
      ]}
      alternatives={[
        {
          href: "/overview",
          label: "See your position instead",
          description: "Totals for money owed, money owed to you, stock and anything waiting on you.",
        },
        {
          href: "/documents?status=review_required",
          label: "Clear your review queue",
          description: "Confirming documents is the one place your input changes your records today.",
        },
      ]}
    >
      {/*
        The suggested questions are listed as reference, deliberately NOT as
        buttons. A clickable prompt that cannot answer anything would be the
        clearest possible fake control, and this product does not ship those.
      */}
      <section aria-labelledby="future-questions" className="flex flex-col gap-3">
        <h2
          id="future-questions"
          className="scroll-mt-20 text-lg font-semibold tracking-tight"
        >
          Questions this screen will answer
        </h2>
        <p className="max-w-prose text-pretty text-sm text-muted-foreground">
          Listed so you know the intended scope. They are not clickable today —
          an input box that cannot answer anything would be worse than no input
          box at all.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {QUESTIONS.map((question) => (
            <li
              key={question}
              className="rounded-lg border border-dashed border-border bg-surface-sunken px-3 py-2 text-sm text-muted-foreground"
            >
              {question}
            </li>
          ))}
        </ul>
      </section>
    </CapabilityPage>
  );
}
