// Created by NMKato Solutions. Focus stays inside a visible modal; no consent is granted.
export function containModalFocus(
  backdrop: HTMLElement,
  options: { initialFocus?: HTMLElement | null; onEscape?: () => void } = {}
): () => void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const outside = new Map<HTMLElement, boolean>();
  let branch: HTMLElement | null = backdrop;
  while (branch?.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        outside.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }

  const focusable = () => Array.from(backdrop.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex]'
  )).filter((element) => element.tabIndex >= 0 &&
    !element.matches(':disabled') && !element.closest('[inert]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');

  const focusFirst = () => (options.initialFocus ?? focusable()[0])?.focus({ preventScroll: true });
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && options.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (items.length === 0) {
      event.preventDefault();
      focusFirst();
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === items.length - 1)) {
      event.preventDefault();
      items[0].focus();
    }
  };
  const focusin = (event: FocusEvent) => {
    if (event.target instanceof Node && !backdrop.contains(event.target)) focusFirst();
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin, true);
  focusFirst();

  return () => {
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin, true);
    for (const [element, wasInert] of outside) element.inert = wasInert;
    if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
  };
}
