import { fetchJson } from "@/lib/http";
import type {
  StudioFocusedPreference,
  StudioSettings,
  StudioSettingsPatch,
} from "@/lib/studio/settings";

export type StudioSettingsResponse = { settings: StudioSettings };

type FocusedPatch = Record<string, Partial<StudioFocusedPreference> | null>;
type SessionsPatch = Record<string, string | null>;

export type StudioSettingsCoordinatorTransport = {
  fetchSettings: () => Promise<StudioSettingsResponse>;
  updateSettings: (patch: StudioSettingsPatch) => Promise<StudioSettingsResponse>;
};

const mergeFocusedPatch = (
  current: FocusedPatch | undefined,
  next: FocusedPatch | undefined
): FocusedPatch | undefined => {
  if (!current && !next) return undefined;
  return {
    ...(current ?? {}),
    ...(next ?? {}),
  };
};

const mergeSessionsPatch = (
  current: SessionsPatch | undefined,
  next: SessionsPatch | undefined
): SessionsPatch | undefined => {
  if (!current && !next) return undefined;
  return {
    ...(current ?? {}),
    ...(next ?? {}),
  };
};

const mergeStudioPatch = (
  current: StudioSettingsPatch | null,
  next: StudioSettingsPatch
): StudioSettingsPatch => {
  if (!current) {
    return {
      ...(next.gateway !== undefined ? { gateway: next.gateway } : {}),
      ...(next.focused ? { focused: { ...next.focused } } : {}),
      ...(next.sessions ? { sessions: { ...next.sessions } } : {}),
    };
  }
  const focused = mergeFocusedPatch(current.focused, next.focused);
  const sessions = mergeSessionsPatch(current.sessions, next.sessions);
  return {
    ...(next.gateway !== undefined
      ? { gateway: next.gateway }
      : current.gateway !== undefined
        ? { gateway: current.gateway }
        : {}),
    ...(focused ? { focused } : {}),
    ...(sessions ? { sessions } : {}),
  };
};

export class StudioSettingsCoordinator {
  private pendingPatch: StudioSettingsPatch | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly transport: StudioSettingsCoordinatorTransport,
    private readonly defaultDebounceMs: number = 350
  ) {}

  async loadSettings(): Promise<StudioSettings | null> {
    const result = await this.transport.fetchSettings();
    return result.settings ?? null;
  }

  schedulePatch(patch: StudioSettingsPatch, debounceMs: number = this.defaultDebounceMs): void {
    if (this.disposed) return;
    this.pendingPatch = mergeStudioPatch(this.pendingPatch, patch);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushPending().catch((err) => {
        console.error("Failed to flush pending studio settings patch.", err);
      });
    }, debounceMs);
  }

  async applyPatchNow(patch: StudioSettingsPatch): Promise<void> {
    if (this.disposed) return;
    this.pendingPatch = mergeStudioPatch(this.pendingPatch, patch);
    await this.flushPending();
  }

  async flushPending(): Promise<void> {
    if (this.disposed) {
      return this.queue;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const patch = this.pendingPatch;
    this.pendingPatch = null;
    if (!patch) {
      return this.queue;
    }
    const write = this.queue.then(async () => {
      await this.transport.updateSettings(patch);
    });
    this.queue = write.catch((err) => {
      console.error("Failed to persist studio settings patch.", err);
    });
    return write;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingPatch = null;
    this.disposed = true;
  }
}

let studioSettingsCoordinator: StudioSettingsCoordinator | null = null;

export const fetchStudioSettings = async (): Promise<StudioSettingsResponse> => {
  return fetchJson<StudioSettingsResponse>("/api/studio", { cache: "no-store" });
};

export const updateStudioSettings = async (
  patch: StudioSettingsPatch
): Promise<StudioSettingsResponse> => {
  return fetchJson<StudioSettingsResponse>("/api/studio", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
};

export const getStudioSettingsCoordinator = (): StudioSettingsCoordinator => {
  if (studioSettingsCoordinator) {
    return studioSettingsCoordinator;
  }
  studioSettingsCoordinator = new StudioSettingsCoordinator({
    fetchSettings: fetchStudioSettings,
    updateSettings: updateStudioSettings,
  });
  return studioSettingsCoordinator;
};

export const resetStudioSettingsCoordinator = () => {
  if (!studioSettingsCoordinator) return;
  studioSettingsCoordinator.dispose();
  studioSettingsCoordinator = null;
};
