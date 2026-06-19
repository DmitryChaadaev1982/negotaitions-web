import Link from "next/link";

import { PageHeader } from "@/components/page-header";

export default function CaseNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Case not found"
        description="The case you are looking for does not exist or is not available."
      />
      <Link
        href="/cases"
        className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        Back to cases
      </Link>
    </div>
  );
}
