import Link from "next/link";

import { PageHeader } from "@/components/page-header";

export default function SessionNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Session not found"
        description="This session does not exist or you do not have access to it."
      />
      <Link
        href="/sessions"
        className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
      >
        Back to sessions
      </Link>
    </div>
  );
}
