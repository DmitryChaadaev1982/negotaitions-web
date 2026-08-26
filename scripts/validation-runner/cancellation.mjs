const OPERATOR_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

export function supportedOperatorSignals(platform = process.platform) {
  if (platform === "win32") {
    return {
      signals: ["SIGINT", "SIGTERM"],
      operator: "Ctrl+C delivers SIGINT in a real Windows console. SIGTERM is handled when Node receives it (service managers / some hosts). Automated child.kill(SIGINT|SIGTERM) on Windows typically TerminateProcess-es the runner and does not run JS handlers.",
      automatedDeliveryReliable: false,
    };
  }
  return {
    signals: ["SIGINT", "SIGTERM"],
    operator: "SIGINT (Ctrl+C) and SIGTERM cancel the run. The runner signals only its dedicated owned process group.",
    automatedDeliveryReliable: true,
  };
}

export function createOperatorCancellation(options = {}) {
  const controller = options.controller ?? new AbortController();
  let inProgress = false;

  const markInProgress = () => {
    if (inProgress) {
      return false;
    }
    inProgress = true;
    if (typeof options.onFirst === "function") {
      options.onFirst();
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
    return true;
  };

  const handleSignal = (signalName) => {
    if (inProgress) {
      if (typeof options.onRepeat === "function") {
        options.onRepeat(signalName);
      }
      return { accepted: false, inProgress: true, signalName };
    }
    markInProgress();
    return { accepted: true, inProgress: true, signalName };
  };

  const attach = (processRef = process) => {
    const listener = (signalName) => {
      handleSignal(signalName);
    };
    for (const signal of OPERATOR_SIGNALS) {
      processRef.on(signal, listener);
    }
    return () => {
      for (const signal of OPERATOR_SIGNALS) {
        processRef.off(signal, listener);
      }
    };
  };

  return {
    controller,
    signals: OPERATOR_SIGNALS,
    handleSignal,
    markInProgress,
    attach,
    isInProgress: () => inProgress,
  };
}

export { OPERATOR_SIGNALS };
