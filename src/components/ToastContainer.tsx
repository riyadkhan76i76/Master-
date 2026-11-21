import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, X } from 'lucide-react';

export interface VerificationToastItem {
  id: string;
  title: string;
  summary: string;
  durationMs?: number;
  createdAt: number;
}

interface ToastContainerProps {
  toasts: VerificationToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 w-[min(380px,calc(100vw-2rem))] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 32, scale: 0.95 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            role="status"
            className="pointer-events-auto rounded-lg border border-emerald-500/50 bg-slate-900/95 backdrop-blur-md shadow-[0_10px_30px_rgba(16,185,129,0.22)] p-3.5 text-slate-100"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-300 truncate">
                    {toast.title}
                  </span>
                  {toast.durationMs != null && (
                    <span className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/70 border border-emerald-700/50 px-1.5 py-0.5 rounded tabular-nums shrink-0">
                      {toast.durationMs.toFixed(1)}ms
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 leading-snug break-words">
                  {toast.summary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="shrink-0 p-0.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
