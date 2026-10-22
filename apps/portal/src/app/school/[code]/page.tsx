import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { SchoolPublicDto } from "@school-kit/types";

import { clientIpHeaders } from "@/lib/client-ip-signature";
import { PORTAL_URL, STAFF_URL, schoolAddressUrl, schoolCodeFromHost } from "@/lib/school-host";

// A school's front page: "<code>.schoolkit.ng" (docs/modules/school-addresses.md
// slice 2), also reachable at portal.schoolkit.ng/school/<code>. The page every
// school has, whatever its plan: its name and logo (SchoolKit's when it has
// none), the ways in for parents, students and staff, the admission form and
// the result checker when they are open, its contacts, and one line of footer.
//
// Rendered on the server on every visit, with the visitor's signed address, so
// the API's per-family rate limit still applies and the logo's signed URL is
// always fresh. An older code redirects to the school's current address.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

async function loadSchool(code: string): Promise<SchoolPublicDto | null> {
  const h = await headers();
  const response = await fetch(`${API_BASE}/school-addresses/${encodeURIComponent(code)}`, {
    cache: "no-store",
    headers: clientIpHeaders((name) => h.get(name)),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`School page: API answered ${response.status}`);
  return (await response.json()) as SchoolPublicDto;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).code).catch(() => null);
  if (!school) return { title: "School not found" };
  return {
    title: school.name,
    description: school.motto ?? `${school.name}: sign in, apply for admission and check results.`,
  };
}

export default async function SchoolFrontPage({ params }: Params) {
  const { code } = await params;
  const school = await loadSchool(code);
  if (!school) notFound();

  const host = (await headers()).get("host");
  const onOwnAddress = schoolCodeFromHost(host) !== null;
  if (school.code !== code.toLowerCase()) {
    redirect((onOwnAddress && schoolAddressUrl(school.code)) || `/school/${school.code}`);
  }
  // On the school's own address the public pages are /apply and /results; on
  // the portal's, the longer paths.
  const applyHref = onOwnAddress ? "/apply" : `/apply/${school.code}`;
  const resultsHref = onOwnAddress ? "/results" : `/result-checker/${school.code}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4">
          {school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed, hour-long URL; next/image would cache it past its life
            <img src={school.logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
          ) : (
            <Image src="/brand/schoolkit-icon.png" alt="" width={48} height={48} />
          )}
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold leading-tight text-foreground">{school.name}</h1>
            {school.motto && <p className="text-sm text-muted-foreground">{school.motto}</p>}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
        <section aria-labelledby="sign-in" className="flex flex-col gap-3">
          <h2 id="sign-in" className="text-lg font-semibold">
            Sign in
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <a
              href={`${PORTAL_URL}/login?school=${encodeURIComponent(school.code)}`}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/40"
            >
              <span className="font-medium">Parents</span>
              <span className="text-sm text-muted-foreground">Fees, results, messages and news.</span>
            </a>
            <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
              <span className="font-medium">Students</span>
              <span className="text-sm text-muted-foreground">
                Sign in on the SchoolKit app with school code <strong className="text-foreground">{school.code}</strong>.
              </span>
            </div>
            <a
              href={`${STAFF_URL}/login?school=${encodeURIComponent(school.code)}`}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm hover:bg-muted/40"
            >
              <span className="font-medium">Staff</span>
              <span className="text-sm text-muted-foreground">Teachers and the school office.</span>
            </a>
          </div>
        </section>

        {(school.admissionsOpen || school.resultChecker) && (
          <section aria-labelledby="for-families" className="flex flex-col gap-3">
            <h2 id="for-families" className="text-lg font-semibold">
              For families
            </h2>
            <div className="flex flex-wrap gap-3">
              {school.admissionsOpen && (
                <a href={applyHref} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  Apply for admission
                </a>
              )}
              {school.resultChecker && (
                <a href={resultsHref} className="rounded-md border bg-card px-4 py-2 text-sm font-medium">
                  Check results with a PIN
                </a>
              )}
            </div>
          </section>
        )}

        {(school.address || school.phone || school.email) && (
          <section aria-labelledby="contact" className="flex flex-col gap-2">
            <h2 id="contact" className="text-lg font-semibold">
              Contact the school
            </h2>
            <dl className="flex flex-col gap-1 text-sm">
              {school.address && (
                <div>
                  <dt className="sr-only">Address</dt>
                  <dd>{school.address}</dd>
                </div>
              )}
              {school.phone && (
                <div>
                  <dt className="sr-only">Phone</dt>
                  <dd>
                    <a href={`tel:${school.phone.replace(/\s+/g, "")}`} className="text-primary underline-offset-2 hover:underline">
                      {school.phone}
                    </a>
                  </dd>
                </div>
              )}
              {school.email && (
                <div>
                  <dt className="sr-only">Email</dt>
                  <dd>
                    <a href={`mailto:${school.email}`} className="text-primary underline-offset-2 hover:underline">
                      {school.email}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}
      </main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} SchoolKit
      </footer>
    </div>
  );
}
