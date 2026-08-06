export function AdminDiagnosticsEmergencyState({
  errorCode,
  message,
}: {
  errorCode: string;
  message: string;
}) {
  return (
    <div
      role="alert"
      data-testid="admin-diagnostics-emergency-state"
      className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <p className="font-mono text-xs">{errorCode}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}
