"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function RawTextCollapsible({ rawText }: { rawText: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <Button
          variant="ghost"
          className="flex items-center gap-2 p-0 h-auto justify-start hover:bg-transparent"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Raw Text / Source Data
          </CardTitle>
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          <ScrollArea className="h-[400px] rounded-md border border-border p-4">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {rawText}
            </pre>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}
