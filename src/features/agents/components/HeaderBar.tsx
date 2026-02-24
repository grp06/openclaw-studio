import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { Plug } from "lucide-react";
import { resolveGatewayStatusBadgeClass } from "./colorSemantics";

type HeaderBarProps = {
  status: GatewayStatus;
  onConnectionSettings: () => void;
  showConnectionSettings?: boolean;
};

export const HeaderBar = ({
  status,
  onConnectionSettings,
  showConnectionSettings = true,
}: HeaderBarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="glass-panel fade-up ui-panel ui-topbar relative z-[180] px-3.5 py-1.5">
      <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="console-title type-page-title text-[21px] leading-[1.08] text-foreground">
            OpenClaw Studio
          </p>
        </div>

        <div className="flex items-center justify-end gap-1.5">
          {status === "connecting" ? (
            <span
              className={`ui-chip px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.08em] ${resolveGatewayStatusBadgeClass("connecting")}`}
              data-testid="gateway-connecting-indicator"
              data-status="connecting"
            >
              Connecting
            </span>
          ) : null}
          <ThemeToggle />
          {showConnectionSettings ? (
            <div className="relative z-[210]" ref={menuRef}>
              <button
                type="button"
                className="ui-btn-icon ui-btn-icon-sm"
                data-testid="studio-menu-toggle"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <Plug className="h-3.5 w-3.5" />
                <span className="sr-only">Open studio menu</span>
              </button>
              {menuOpen ? (
                <div className="ui-card ui-menu-popover absolute right-0 top-11 z-[260] min-w-44 p-1">
                  <button
                    className="ui-btn-ghost w-full justify-start border-transparent px-3 py-2 text-left text-xs font-medium tracking-normal text-foreground"
                    type="button"
                    onClick={() => {
                      onConnectionSettings();
                      setMenuOpen(false);
                    }}
                    data-testid="gateway-settings-toggle"
                  >
                    Gateway connection
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
