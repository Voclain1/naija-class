import { Loader2 } from "lucide-react";

export function BrandLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <p className="text-lg font-semibold tracking-tight text-foreground">
        School Kit
      </p>
      <Loader2
        className="h-6 w-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    </div>
  );
}
