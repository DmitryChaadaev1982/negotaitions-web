import { SessionStatus } from "@/app/generated/prisma/client";
import { updateSessionStatus } from "@/app/actions/sessions";

type SessionStatusActionsProps = {
  sessionId: string;
  status: SessionStatus;
};

const statusActions: {
  status: SessionStatus;
  label: string;
}[] = [
  { status: SessionStatus.READY, label: "Mark READY" },
  { status: SessionStatus.IN_PROGRESS, label: "Mark IN PROGRESS" },
  { status: SessionStatus.COMPLETED, label: "Mark COMPLETED" },
];

export function SessionStatusActions({
  sessionId,
  status,
}: SessionStatusActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {statusActions.map((action) => {
        const isCurrent = status === action.status;

        return (
          <form key={action.status} action={updateSessionStatus}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="status" value={action.status} />
            <button
              type="submit"
              disabled={isCurrent}
              className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-default ${
                isCurrent
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {action.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
