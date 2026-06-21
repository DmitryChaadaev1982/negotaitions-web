import Link from "next/link";

import { getAppName } from "@/lib/config";

export default function JoinNotFound() {
  const appName = getAppName();

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-sm text-slate-500">{appName}</p>
        <h1 className="text-2xl font-semibold text-slate-900">Invalid join link</h1>
        <p className="text-sm text-slate-600">
          This join link is invalid or has expired. Ask your facilitator for a
          new link.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Go to home
        </Link>
      </div>
    </div>
  );
}
