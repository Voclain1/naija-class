"use client";

import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ConsoleHeading } from "./console-shell";
import { PaystackRequestsCard } from "./paystack-requests";
import { SetupCallsCard } from "./setup-calls";
import { WebsiteReportsCard } from "./website-review";

// Work waiting on the team, one tab each (2026-10-30 console redesign). The
// tab is kept in ?tab= so the Overview's "Needs you" lines open the right one.

const TABS = [
  { value: "calls", label: "Setup calls" },
  { value: "paystack", label: "Paystack setup" },
  { value: "websites", label: "Website reports" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function RequestsPanel() {
  const [tab, setTab] = useState<Tab>("calls");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((x) => x.value === t)) setTab(t as Tab);
  }, []);

  return (
    <>
      <ConsoleHeading
        title="Requests"
        description="Setup calls to hold, Paystack subaccounts to create and website reports to answer."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
          window.history.replaceState(null, "", `?tab=${v}`);
        }}
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="calls" className="mt-4">
          <SetupCallsCard />
        </TabsContent>
        <TabsContent value="paystack" className="mt-4">
          <PaystackRequestsCard />
        </TabsContent>
        <TabsContent value="websites" className="mt-4">
          <WebsiteReportsCard />
        </TabsContent>
      </Tabs>
    </>
  );
}
