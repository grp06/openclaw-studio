import {
  getControlPlaneRuntime,
  isStudioDomainApiModeEnabled,
  type ControlPlaneRuntime,
} from "@/lib/controlplane/runtime";
import { serializeControlPlaneGatewayConnectFailure } from "@/lib/controlplane/openclaw-adapter";
import {
  classifyRuntimeInitError,
  type RuntimeInitFailure,
} from "@/lib/controlplane/runtime-init-errors";

type DomainRuntimeBootstrapResult =
  | { kind: "mode-disabled" }
  | { kind: "runtime-init-failed"; failure: RuntimeInitFailure }
  | {
      kind: "start-failed";
      message: string;
      startFailure:
        | ReturnType<typeof serializeControlPlaneGatewayConnectFailure>
        | null;
      runtime: ControlPlaneRuntime;
    }
  | { kind: "ready"; runtime: ControlPlaneRuntime };

const resolveErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export async function bootstrapDomainRuntime(): Promise<DomainRuntimeBootstrapResult> {
  if (!isStudioDomainApiModeEnabled()) {
    return { kind: "mode-disabled" };
  }

  let runtime: ControlPlaneRuntime;
  try {
    runtime = getControlPlaneRuntime();
  } catch (error) {
    return {
      kind: "runtime-init-failed",
      failure: classifyRuntimeInitError(error),
    };
  }

  try {
    await runtime.ensureStarted();
    return { kind: "ready", runtime };
  } catch (error) {
    const startFailure = serializeControlPlaneGatewayConnectFailure(error);
    const message = startFailure?.message ?? resolveErrorMessage(error, "controlplane_start_failed");
    return { kind: "start-failed", message, startFailure, runtime };
  }
}
