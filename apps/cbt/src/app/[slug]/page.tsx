import { ExamApp } from "@/components/exam-app";

// cbt.schoolkit.ng/<school> — the address on the invigilator sheet. Everything
// happens in the browser from here (docs/modules/cbt.md D6).
export default async function SchoolExams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ExamApp slug={decodeURIComponent(slug).toLowerCase()} />;
}
