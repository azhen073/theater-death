import { useEffect, useId, useRef, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export function Emblem() {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="m32 3 25 16v27L32 61 7 46V19L32 3Z" stroke="currentColor"/><path d="m32 3-8 21L7 19l20 13L7 46l21-7 4 22 6-23 19 8-20-14 20-13-21 6-4-22Z" fill="currentColor" opacity=".15"/><path d="m32 13 6 19-6 18-6-18 6-19Z" stroke="currentColor"/></svg>;
}

export function Avatar({ url, name, size = 'normal' }: { url: string | null; name: string; size?: 'small' | 'normal' | 'large' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className={`avatar avatar--${size}`}>
    {url && !failed ? <img src={url} alt={`${name}的头像`} onError={() => setFailed(true)} /> :
      <svg viewBox="928 213 472 472" role="img" aria-label="默认头像"><image href="/assets/avatar-sheet.png" width="1774" height="887" /></svg>}
  </span>;
}

export function Field({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return <label className="field" htmlFor={id}><span id={`${id}-label`} className="field__label">{label}</span>
    <input {...props} id={id} aria-labelledby={`${id}-label`} aria-invalid={!!error} aria-describedby={hint || error ? `${id}-hint` : undefined}/>
    {(hint || error) && <span id={`${id}-hint`} className={error ? 'field__error' : 'field__hint'}>{error || hint}</span>}
  </label>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'notice--error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}

export function Modal({ title, children, onClose, dismissible = true, context }: { title: string; children: ReactNode; onClose: () => void; dismissible?: boolean; context?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected && previousFocus.getClientRects().length && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}>
    <header className="modal__head"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="关闭" disabled={!dismissible} onClick={onClose}>×</button></header>
    {context}
    {children}
  </dialog>;
}

export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{children && <p>{children}</p>}</header>;
}
