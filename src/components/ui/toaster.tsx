import React, { useEffect } from "react";
import { toast as sonnerToast, Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  useEffect(() => {
    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        startX = touch.clientX;
        startY = touch.clientY;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      const toastCard = target?.closest('[data-sonner-toast]');
      if (!toastCard) return;

      const touch = e.changedTouches[0];
      if (touch) {
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        // If swiped more than 20px in any direction (horizontal or vertical)
        if (dist > 20 || Math.abs(deltaX) > 20 || Math.abs(deltaY) > 20) {
          sonnerToast.dismiss();
          return;
        }
      }

      // Tap dismiss
      if (!target?.closest('a') && !target?.closest('input') && !target?.closest('button:not([data-close-button])')) {
        sonnerToast.dismiss();
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const toastCard = target?.closest('[data-sonner-toast]');
      if (toastCard && !target?.closest('a') && !target?.closest('input') && !target?.closest('button:not([data-close-button])')) {
        sonnerToast.dismiss();
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  return (
    <SonnerToaster
      position="bottom-center"
      duration={4000}
      closeButton={true}
      richColors={true}
      expand={false}
      offset="24px"
      toastOptions={{
        duration: 4000,
        className: 'select-none pointer-events-auto shadow-lg',
      }}
    />
  );
}

// Re-export toast from sonner directly
export { sonnerToast as toast };
