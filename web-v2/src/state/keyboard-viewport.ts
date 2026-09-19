import { useEffect } from 'react';

/** Keep the fixed action strip above an on-screen keyboard without moving focus. */
export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    let restingHeight = window.innerHeight;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = document.activeElement;
        const editable = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && ['text', 'password', 'search', 'email', 'tel', 'url', 'number'].includes(element.type);
        if (!editable) restingHeight = window.innerHeight;
        const inset = editable && viewport && viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        const open = inset > 80 || editable && window.innerHeight < restingHeight - 80;
        document.documentElement.style.setProperty('--keyboard-inset', open ? `${inset}px` : '0px');
        document.documentElement.dataset.keyboardOpen = String(open);
        if (open && element instanceof HTMLElement) {
          const target = element.closest<HTMLElement>('.chat-composer') ?? element;
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        }
      });
    };
    viewport?.addEventListener('resize', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('focusin', sync); document.addEventListener('focusout', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame); viewport?.removeEventListener('resize', sync); window.removeEventListener('resize', sync);
      document.removeEventListener('focusin', sync); document.removeEventListener('focusout', sync);
      document.documentElement.style.removeProperty('--keyboard-inset'); delete document.documentElement.dataset.keyboardOpen;
    };
  }, []);
}
