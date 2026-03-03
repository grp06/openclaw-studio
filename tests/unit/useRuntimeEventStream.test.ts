import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventFrame } from "@/lib/gateway/gateway-frames";
import { useRuntimeEventStream, type RuntimeEventStreamSource } from "@/features/agents/state/useRuntimeEventStream";

type MockStreamEvent = {
  data?: unknown;
  lastEventId?: unknown;
};

type ListenerMap = Record<string, Array<(event: MockStreamEvent) => void>>;

const createMockSource = () => {
  const listeners: ListenerMap = {};
  return {
    source: {
      onerror: null,
      addEventListener: (type: string, listener: (event: MockStreamEvent) => void) => {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(listener);
      },
      close: vi.fn(),
    } satisfies RuntimeEventStreamSource,
    emit: (type: string, event: MockStreamEvent = {}) => {
      for (const listener of listeners[type] ?? []) {
        listener(event);
      }
    },
  };
};

describe("useRuntimeEventStream", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("resumes from persisted lastEventId and persists newer ids", () => {
    const stream = createMockSource();
    const createSource = vi.fn(() => stream.source);
    sessionStorage.setItem("openclaw.runtime.lastEventId:gateway-a", "25");

    const gatewayHandler = vi.fn<(event: EventFrame) => void>();
    const statusHandler = vi.fn();

    const Probe = () => {
      useRuntimeEventStream({
        onGatewayEvent: gatewayHandler,
        onRuntimeStatus: statusHandler,
        createSource,
        resumeKey: "gateway-a",
      });
      return createElement("div");
    };

    const rendered = render(createElement(Probe));

    expect(createSource).toHaveBeenCalledWith("/api/runtime/stream?lastEventId=25");

    stream.emit("gateway.event", {
      lastEventId: "31",
      data: JSON.stringify({
        event: "chat",
        payload: { text: "hello" },
      }),
    });
    expect(sessionStorage.getItem("openclaw.runtime.lastEventId:gateway-a")).toBe("31");

    rendered.unmount();
    expect(stream.source.close).toHaveBeenCalledTimes(1);
  });

  it("keeps one stream subscription while callbacks change", () => {
    const stream = createMockSource();
    const createSource = vi.fn(() => stream.source);
    const initialGatewayHandler = vi.fn<(event: EventFrame) => void>();
    const initialStatusHandler = vi.fn();

    const Probe = ({
      onGatewayEvent,
      onRuntimeStatus,
    }: {
      onGatewayEvent: (event: EventFrame) => void;
      onRuntimeStatus: () => void;
    }) => {
      useRuntimeEventStream({
        onGatewayEvent,
        onRuntimeStatus,
        createSource,
      });
      return createElement("div");
    };

    const rendered = render(
      createElement(Probe, {
        onGatewayEvent: initialGatewayHandler,
        onRuntimeStatus: initialStatusHandler,
      })
    );

    expect(createSource).toHaveBeenCalledTimes(1);

    const updatedGatewayHandler = vi.fn<(event: EventFrame) => void>();
    const updatedStatusHandler = vi.fn();
    rendered.rerender(
      createElement(Probe, {
        onGatewayEvent: updatedGatewayHandler,
        onRuntimeStatus: updatedStatusHandler,
      })
    );

    expect(createSource).toHaveBeenCalledTimes(1);

    stream.emit("gateway.event", {
      data: JSON.stringify({
        event: "chat",
        payload: { text: "hello" },
        seq: 42,
      }),
    });
    expect(initialGatewayHandler).not.toHaveBeenCalled();
    expect(updatedGatewayHandler).toHaveBeenCalledTimes(1);
    expect(updatedGatewayHandler).toHaveBeenCalledWith({
      type: "event",
      event: "chat",
      payload: { text: "hello" },
      seq: 42,
    });

    stream.emit("runtime.status");
    expect(initialStatusHandler).not.toHaveBeenCalled();
    expect(updatedStatusHandler).toHaveBeenCalledTimes(1);

    rendered.unmount();
    expect(stream.source.close).toHaveBeenCalledTimes(1);
  });
});
