import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { Bell, Plug } from "lucide-react";
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
  const [notificationsAvailable, setNotificationsAvailable] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission | "unsupported">("unsupported");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = window.isSecureContext && "Notification" in window;
    setNotificationsAvailable(supported);
    setNotificationPermission(supported ? Notification.permission : "unsupported");
  }, []);

  const handleNotificationsClick = async () => {
    if (!notificationsAvailable) return;
    if (Notification.permission === "granted") {
      new Notification("OpenClaw Studio", {
        body: "Notifications are on. You'll get in-tab alerts for key events.",
        tag: "studio-notifications-test",
      });
      return;
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        new Notification("OpenClaw Studio", {
          body: "Notifications enabled successfully.",
          tag: "studio-notifications-enabled",
        });
      }
    }
  };

  return (
    <div className="ui-topbar relative z-[180]">
      <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 sm:px-4 md:px-5">
        <div aria-hidden="true" />
        <p className="truncate text-sm font-semibold tracking-[0.01em] text-foreground">
          OpenClaw Studio
        </p>
        <div className="flex items-center justify-end gap-1">
          {status === "connecting" ? (
            <span
              className={`ui-chip px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] ${resolveGatewayStatusBadgeClass("connecting")}`}
              data-testid="gateway-connecting-indicator"
              data-status="connecting"
            >
              Connecting
            </span>
          ) : null}
          {notificationsAvailable ? (
            <button
              type="button"
              className="ui-btn-icon ui-btn-icon-xs"
              onClick={() => {
                void handleNotificationsClick();
              }}
              aria-label={
                notificationPermission === "granted"
                  ? "Send test notification"
                  : "Enable notifications"
              }
              title={
                notificationPermission === "granted"
                  ? "Send test notification"
                  : notificationPermission === "denied"
                    ? "Notifications are blocked in browser settings"
                    : "Enable notifications"
              }
              data-testid="notifications-toggle"
            >
              <Bell className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <ThemeToggle />
          {showConnectionSettings ? (
            <div className="relative z-[210]" ref={menuRef}>
              <button
                type="button"
                className="ui-btn-icon ui-btn-icon-xs"
                data-testid="studio-menu-toggle"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <Plug className="h-3.5 w-3.5" />
                <span className="sr-only">Open studio menu</span>
              </button>
              {menuOpen ? (
                <div className="ui-card ui-menu-popover absolute right-0 top-9 z-[260] min-w-44 p-1">
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
