"use client";

import * as React from "react";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type ConfirmRequest = {
  id: string;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest((prev) => {
        if (prev) prev.resolve(false);
        return { id: crypto.randomUUID(), options, resolve };
      });
    });
  }, []);

  const handleClose = React.useCallback(
    (value: boolean) => {
      setRequest((prev) => {
        if (!prev) return null;
        prev.resolve(value);
        return null;
      });
    },
    []
  );

  const value = React.useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog request={request} onClose={handleClose} />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}

function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: (value: boolean) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
  }, [request]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handler = (event: Event) => {
      // Prevent <dialog> default close via ESC from bypassing our resolver.
      event.preventDefault();
      onClose(false);
    };

    dialog.addEventListener("cancel", handler);
    return () => dialog.removeEventListener("cancel", handler);
  }, [onClose]);

  const opts = request?.options;
  const cancelText = opts?.cancelText ?? "Cancel";
  const confirmText = opts?.confirmText ?? "Confirm";

  return (
    <dialog
      ref={dialogRef}
      className="rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      {opts ? (
        <div className="w-[min(520px,calc(100vw-2rem))] p-6">
          <div className="text-lg font-semibold">{opts.title}</div>
          {opts.description ? (
            <div className="mt-2 text-sm text-muted-foreground">{opts.description}</div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold text-foreground"
              onClick={() => onClose(false)}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition hover:brightness-110 ${
                opts.destructive
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground"
              }`}
              onClick={() => onClose(true)}
              autoFocus
            >
              {confirmText}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
