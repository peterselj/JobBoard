import { useEffect, type ReactNode } from 'react';

function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

// ---------- Buttons ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-200/70',
  danger: 'bg-white text-red-600 border border-red-300 hover:bg-red-50',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  const sizeCls = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${sizeCls} ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------- Badge ----------

export function Badge({
  color = 'slate',
  children,
  title,
}: {
  color?: 'slate' | 'emerald' | 'green' | 'amber' | 'red' | 'sky';
  children: ReactNode;
  title?: string;
}) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    green: 'bg-green-50 text-green-700 ring-green-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colors[color]}`}>
      {children}
    </span>
  );
}

// ---------- Form fields ----------

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

// ---------- Overlays ----------

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`mt-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-y-0 right-0 w-[560px] max-w-full overflow-y-auto bg-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

// ---------- Misc ----------

export function StatCard({ label, value, sub, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${accent ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent ? 'text-emerald-800' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mt-2 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
      {children}
    </div>
  );
}
