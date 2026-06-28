import VoximplantTestClient from "@/components/voximplant-test-client";

import { getVoximplantTestConfig } from "@/lib/voximplant-test/config";

export default function VoximplantTestPage() {
  let config: ReturnType<typeof getVoximplantTestConfig>;
  try {
    config = getVoximplantTestConfig();
  } catch (error) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6 text-center text-slate-100">
        <div className="space-y-3 rounded-lg border border-rose-500/60 bg-rose-900/30 p-6">
          <h1 className="text-lg font-semibold">Voximplant test page configuration error</h1>
          <p className="text-sm text-rose-200">
            {error instanceof Error ? error.message : "Unknown configuration error."}
          </p>
        </div>
      </div>
    );
  }

  if (!config.enabled) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6 text-center text-slate-100">
        <div className="space-y-3 rounded-lg border border-amber-500/60 bg-amber-900/30 p-6">
          <h1 className="text-lg font-semibold">Voximplant test page is disabled</h1>
          <p className="text-sm text-amber-200">
            This standalone smoke page is available in local/dev mode only.
          </p>
        </div>
      </div>
    );
  }

  if (config.videoProvider !== "voximplant") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6 text-center text-slate-100">
        <div className="space-y-3 rounded-lg border border-rose-500/60 bg-rose-900/30 p-6">
          <h1 className="text-lg font-semibold">Voximplant provider is not enabled</h1>
          <p className="text-sm text-rose-200">
            Set <code>VIDEO_PROVIDER=voximplant</code> in local environment settings.
          </p>
        </div>
      </div>
    );
  }

  return <VoximplantTestClient />;
}
