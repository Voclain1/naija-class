"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { ApiError, proxyFetch } from "@/lib/api-client";

/**
 * Loads one platform-admin list for a console page. A 401 or 403 means the
 * platform session ended, so it goes back to the sign-in page.
 */
export function usePlatformLoad<T>(
  url: string,
  failure: string,
): [T | null, Dispatch<SetStateAction<T | null>>, string | null, () => void] {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proxyFetch<T>(url, { method: "GET" })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (
          err instanceof ApiError &&
          (err.status === 401 || err.status === 403)
        ) {
          router.replace("/super-admin/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : failure);
      });
  }, [url, failure, router]);

  useEffect(load, [load]);

  return [data, setData, error, load];
}
