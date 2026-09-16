import { useEffect, useRef, type DetailsHTMLAttributes } from 'react';

/** Animate the details box itself so opening/closing also works without
 * interpolate-size/::details-content support. Native summary keyboard behavior remains. */
export function AnimatedDetails({
  children,
  className = '',
  onClick,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const ref = useRef<HTMLDetailsElement>(null);
  const animation = useRef<Animation | null>(null);
  const target = useRef<boolean | null>(null);
  useEffect(() => () => animation.current?.cancel(), []);
  return (
    <details
      {...props}
      ref={ref}
      className={`animated-details ${className}`}
      onClick={(event) => {
        onClick?.(event);
        const element = ref.current;
        const summary = (event.target as Element).closest('summary');
        if (event.defaultPrevented || !element || summary?.parentElement !== element) return;
        if (!element.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          return;
        event.preventDefault();
        const opening = !(target.current ?? element.open);
        const from = element.getBoundingClientRect().height;
        animation.current?.cancel();
        target.current = opening;
        element.open = true;
        const style = getComputedStyle(element);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const to = opening
          ? element.scrollHeight + border
          : summary.getBoundingClientRect().height +
            border +
            parseFloat(style.paddingTop) +
            parseFloat(style.paddingBottom);
        element.style.overflow = 'hidden';
        const current = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration: 180,
          easing: 'ease-out',
        });
        animation.current = current;
        current.onfinish = () => {
          if (animation.current !== current) return;
          element.open = opening;
          element.style.overflow = '';
          animation.current = null;
          target.current = null;
        };
      }}
    >
      {children}
    </details>
  );
}
