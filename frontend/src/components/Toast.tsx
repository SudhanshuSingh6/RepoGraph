import { useEffect, useState } from "react";

type ToastKind = "error" | "info" | "success";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (toasts: ToastItem[]) => void;

let _toasts: ToastItem[] = [];
let _listener: Listener | null = null;
let _nextId = 1;

function notify() {
  _listener?.([..._toasts]);
}

export function toast(message: string, kind: ToastKind = "error") {
  const id = _nextId++;
  _toasts.push({ id, message, kind });
  notify();
  setTimeout(() => {
    _toasts = _toasts.filter((t) => t.id !== id);
    notify();
  }, 5000);
}

const KIND_STYLES: Record<ToastKind, string> = {
  error: "bg-red-900/90 border-red-700 text-red-100",
  info: "bg-gray-800/90 border-gray-600 text-gray-100",
  success: "bg-green-900/90 border-green-700 text-green-100",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    _listener = setToasts;
    return () => {
      _listener = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`text-xs px-4 py-2 rounded-lg border shadow-xl max-w-md truncate animate-[slideUp_0.2s_ease-out] ${KIND_STYLES[t.kind]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
