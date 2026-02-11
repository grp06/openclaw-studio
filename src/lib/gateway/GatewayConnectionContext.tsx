"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useGatewayConnection, type GatewayConnectionState } from "./GatewayClient";
import {
  createStudioSettingsCoordinator,
  type StudioSettingsCoordinator,
} from "@/lib/studio/coordinator";

export type GatewayConnectionContextValue = GatewayConnectionState & {
  settingsCoordinator: StudioSettingsCoordinator;
};

const GatewayConnectionContext = createContext<GatewayConnectionContextValue | null>(null);

export const useGatewayConnectionContext = (): GatewayConnectionContextValue => {
  const ctx = useContext(GatewayConnectionContext);
  if (!ctx) {
    throw new Error(
      "useGatewayConnectionContext must be used within a GatewayConnectionProvider"
    );
  }
  return ctx;
};

export type GatewayConnectionProviderProps = {
  children: ReactNode;
};

export const GatewayConnectionProvider = ({ children }: GatewayConnectionProviderProps) => {
  const [settingsCoordinator] = useState(() => createStudioSettingsCoordinator());
  const connection = useGatewayConnection(settingsCoordinator);

  const value: GatewayConnectionContextValue = {
    ...connection,
    settingsCoordinator,
  };

  return (
    <GatewayConnectionContext.Provider value={value}>
      {children}
    </GatewayConnectionContext.Provider>
  );
};
