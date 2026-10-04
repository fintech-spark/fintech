"use client";

import * as React from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Send,
  Sparkles,
  AlertCircle,
  FileCheck2,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Wrench,
  Cpu,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { askBusinessBrain } from "@/app/(dashboard)/business-brain/actions";
import type { WireAiChatResponse } from "@/lib/api/contracts";

interface BusinessBrainClientProps {
  readonly businessId: string;
  readonly businessName: string;
}

interface ChatExchange {
  readonly id: string;
  readonly question: string;
  readonly response?: WireAiChatResponse;
  readonly error?: string;
  readonly isLoading?: boolean;
}

const SAMPLE_QUESTIONS = [
  "Why did my profit drop last month?",
  "Which customers have overdue receivables?",
  "How is my cash flow looking for the next 30 days?",
  "What inventory products should I restock soon?",
];

export function BusinessBrainClient({ businessId, businessName }: BusinessBrainClientProps) {
  const [messages, setMessages] = React.useState<ChatExchange[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [sessionId] = React.useState(() => crypto.randomUUID());
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const messageIdCounter = React.useRef(0);

  const handleSubmit = React.useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    messageIdCounter.current += 1;
    const exchangeId = `msg-${messageIdCounter.current}`;
    const newExchange: ChatExchange = {
      id: exchangeId,
      question: trimmed,
      isLoading: true,
    };

    setMessages((prev) => [...prev, newExchange]);
    setInputValue("");
    setIsLoading(true);

    try {
      const outcome = await askBusinessBrain(businessId, trimmed, sessionId);
      if (outcome.outcome === "success") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === exchangeId ? { ...msg, response: outcome.response, isLoading: false } : msg,
          ),
        );
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === exchangeId ? { ...msg, error: outcome.message, isLoading: false } : msg,
          ),
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to retrieve reasoning from Business Brain";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === exchangeId ? { ...msg, error: errorMessage, isLoading: false } : msg,
        ),
      );
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [businessId, isLoading, sessionId]);

  const getConfidenceBadge = (confidence: WireAiChatResponse["confidence"]) => {
    switch (confidence) {
      case "high":
        return (
          <Badge variant="outline" className="border-positive-border bg-positive-subtle text-positive-foreground">
            <CheckCircle2 className="size-3 mr-1" /> HIGH GROUNDING
          </Badge>
        );
      case "medium":
        return (
          <Badge variant="outline" className="border-info-border bg-info-subtle text-info-foreground">
            <Calculator className="size-3 mr-1" /> MEDIUM GROUNDING
          </Badge>
        );
      case "low":
        return (
          <Badge variant="outline" className="border-caution-border bg-caution-subtle text-caution-foreground">
            <AlertCircle className="size-3 mr-1" /> LIMITED HISTORY
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Philosophy Banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-primary" />
            <CardTitle className="text-base font-semibold">Grounded AI Business Reasoning</CardTitle>
          </div>
          <CardDescription>
            Merchant Brain synthesizes your actual invoices, sales, expenses, and ledger records.
            Numbers are calculated deterministically in TypeScript and cross-referenced with your data.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Suggested Questions */}
      {messages.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Suggested Investigations for {businessName}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleSubmit(q)}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-left text-sm text-foreground transition-colors hover:border-primary hover:bg-accent"
              >
                <span>{q}</span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Thread */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-6">
          {messages.map((exchange) => (
            <div key={exchange.id} className="flex flex-col gap-4">
              {/* Question Bubble */}
              <div className="flex justify-end">
                <div className="max-w-2xl rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-xs">
                  {exchange.question}
                </div>
              </div>

              {/* Answer Card */}
              <div className="flex justify-start">
                <Card className="w-full max-w-3xl border-border bg-card shadow-xs">
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold">Merchant Brain</CardTitle>
                      {exchange.isLoading && <Spinner className="size-3.5 text-muted-foreground" />}
                    </div>
                    {exchange.response && getConfidenceBadge(exchange.response.confidence)}
                  </CardHeader>

                  <CardContent className="flex flex-col gap-4 text-sm">
                    {exchange.isLoading && (
                      <div className="flex items-center gap-2 text-muted-foreground py-2">
                        <Spinner className="size-4" />
                        <span>Consulting financial records and calculating metrics...</span>
                      </div>
                    )}

                    {exchange.error && (
                      <div className="flex items-center gap-2 py-2 text-destructive" role="alert">
                        <AlertCircle className="size-4" />
                        <span>{exchange.error}</span>
                      </div>
                    )}

                    {exchange.response && (
                      <>
                        {/* Main Narrative */}
                        <div className="whitespace-pre-wrap leading-relaxed text-foreground">
                          {exchange.response.message}
                        </div>

                        {/* Tools & Evidence Used */}
                        {(exchange.response.toolsUsed.length > 0 || exchange.response.evidence.length > 0) && (
                          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                              Verified Evidence & Analytics Tools
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {exchange.response.toolsUsed.map((tool, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs bg-background">
                                  <Wrench className="size-3 mr-1 text-primary" />
                                  {typeof tool === "string" ? tool : JSON.stringify(tool)}
                                </Badge>
                              ))}
                              {exchange.response.evidence.map((item, idx) => (
                                <Badge key={`ev-${idx}`} variant="outline" className="text-xs bg-background text-positive-foreground">
                                  <FileCheck2 className="size-3 mr-1 text-positive-foreground" />
                                  {typeof item === "string" ? item : JSON.stringify(item)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Execution Metadata */}
                        {exchange.response.metadata && (
                          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                            <div className="flex items-center gap-1">
                              <Cpu className="size-3" />
                              <span>Model: {exchange.response.metadata.modelUsed}</span>
                            </div>
                            <span>•</span>
                            <span>Latency: {exchange.response.metadata.totalLatencyMs}ms</span>
                            {exchange.response.metadata.ragContextUsed && (
                              <>
                                <span>•</span>
                                <span className="text-primary font-medium">RAG Grounded</span>
                              </>
                            )}
                          </div>
                        )}

                        {/* Link to Action Center */}
                        <div className="pt-1">
                          <Separator className="mb-3" />
                          <Button variant="outline" size="sm" asChild>
                            <Link href="/actions">
                              View Operational Action Center
                              <ArrowRight className="size-3.5 ml-1" />
                            </Link>
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(inputValue);
        }}
        className="sticky bottom-4 mt-auto rounded-xl border border-border bg-card p-2 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <input
            aria-label="Ask Merchant Brain a question"
            autoComplete="off"
            name="business-question"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about revenue, profit leaks, overdue invoices, or stock…"
            disabled={isLoading}
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={isLoading || !inputValue.trim()}>
            {isLoading ? <Spinner className="size-4" /> : <Send className="size-4" />}
            <span className="sr-only">Send message</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
