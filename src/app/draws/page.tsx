"use client";

import { Typography } from "@heroui/react";
import DrawsList from "@/components/DrawsList";
import { AppShell } from "@/components/AppShell";

export default function DrawsPage() {
  return (
    <AppShell title="Draws">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 pt-8 sm:pt-10 pb-12 flex flex-col gap-6">
        <div className="max-w-3xl">
          <Typography type="h4">Draws</Typography>
          <Typography type="body-sm" color="muted" className="mt-1.5">
            Winners are picked from eligible holders with drand randomness — a public beacon
            nobody controls.
          </Typography>
        </div>
        <DrawsList className="flex flex-col" />
      </div>
    </AppShell>
  );
}