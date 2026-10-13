import { describeLoadError, type LoadFailureWording } from "../lib/api/load-error";
import { Button, Notice } from "./ui";

/**
 * A failed load, said honestly: the sentence fits the error, and "Try again"
 * shows only when trying again can work (src/lib/api/load-error.ts).
 */
export function LoadError({
  error,
  onRetry,
  ...wording
}: LoadFailureWording & { error: unknown; onRetry?: () => void }) {
  const failure = describeLoadError(error, wording);
  return (
    <>
      <Notice tone="danger">{failure.message}</Notice>
      {failure.retry && onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} />}
    </>
  );
}
