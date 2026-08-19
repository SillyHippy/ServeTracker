import React, { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}

const PULL_THRESHOLD = 70;
const MAX_PULL = 100;
const RESISTANCE = 0.45;

const isScrollableElement = (el: Element): boolean => {
  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    el.scrollHeight > el.clientHeight + 1
  );
};

/**
 * Find the element that actually scrolls the page content.
 *
 * The app's <main> has `overflow-y-auto` and becomes a real scroll container
 * whenever the layout is height-constrained (e.g. iOS forces .min-h-screen to
 * 100dvh), while on Android Chrome the layout grows and the *document* scrolls.
 * Reading document.scrollingElement unconditionally returns 0 in the first
 * case, which made pull-to-refresh arm on every touchstart no matter how far
 * down the page the user was — hijacking ordinary scroll-up gestures (pop-in
 * indicator, layout shift, and a hard page reload on release).
 */
const resolvePageScroller = (container: HTMLElement): Element => {
  let el: Element | null = container.parentElement;
  while (el && el !== document.body) {
    if (isScrollableElement(el)) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};

const getScrollTop = (scroller: Element): number =>
  scroller ? scroller.scrollTop : window.scrollY || 0;

/**
 * True when the touch target lives inside a nested scrollable area
 * (combobox list, modal, card list, etc.) other than the page scroller
 * itself. Pull gestures that start there belong to that inner scroller,
 * so pull-to-refresh must not hijack them.
 */
const isInsideScrollable = (target: EventTarget | null, pageScroller: Element): boolean => {
  if (!(target instanceof Element)) return false;
  let el: Element | null = target as Element;
  while (el && el !== document.body && el !== pageScroller) {
    // Stop at overlay/popover boundaries — content above them is page content.
    if (el.getAttribute("role") === "dialog" || el.hasAttribute("data-radix-popper-content-wrapper")) {
      break;
    }
    if (isScrollableElement(el)) return true;
    el = el.parentElement;
  }
  return false;
};

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
  const [pullDistance, setPullDistance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Refs mirror state so touch listeners can be bound exactly once. Binding
  // inside a state-driven effect (as before) re-adds listeners on every pixel
  // of pull, which can drop touchmove events mid-gesture on mobile browsers.
  const pullDistanceRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const touchStartYRef = useRef<number>(0);
  const gestureActiveRef = useRef<boolean>(false);
  const pageScrollerRef = useRef<Element | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const updatePull = (value: number) => {
    // Skip redundant writes — per-pixel setState from touchmove re-renders the
    // whole subtree and can make native scrolling feel janky/stuck on Android
    // Chrome, even though the listeners themselves are passive.
    if (pullDistanceRef.current === value) return;
    pullDistanceRef.current = value;
    setPullDistance(value);
  };

  const updateRefreshing = (value: boolean) => {
    isRefreshingRef.current = value;
    setIsRefreshing(value);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) {
        gestureActiveRef.current = false;
        return;
      }
      const pageScroller = resolvePageScroller(container);
      pageScrollerRef.current = pageScroller;
      // Only enable pull-to-refresh at the very top of the page, and not when
      // the gesture starts inside a nested scrollable (e.g. search list).
      if (getScrollTop(pageScroller) > 2 || isInsideScrollable(e.target, pageScroller)) {
        gestureActiveRef.current = false;
        touchStartYRef.current = 0;
        return;
      }
      gestureActiveRef.current = true;
      touchStartYRef.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!gestureActiveRef.current || isRefreshingRef.current) return;

      // User scrolled away from the top mid-gesture (momentum, etc.) — bail out.
      const pageScroller = pageScrollerRef.current;
      if (!pageScroller || getScrollTop(pageScroller) > 2) {
        gestureActiveRef.current = false;
        updatePull(0);
        return;
      }

      const dy = e.touches[0].clientY - touchStartYRef.current;
      if (dy > 0) {
        // Resistance factor
        updatePull(Math.min(dy * RESISTANCE, MAX_PULL));
      } else {
        updatePull(0);
      }
    };

    const handleTouchEnd = async () => {
      if (!gestureActiveRef.current) return;
      gestureActiveRef.current = false;
      const distance = pullDistanceRef.current;
      touchStartYRef.current = 0;

      if (distance >= PULL_THRESHOLD && !isRefreshingRef.current) {
        updateRefreshing(true);
        updatePull(50);
        try {
          await onRefreshRef.current();
        } catch (err) {
          console.error("Refresh failed:", err);
        } finally {
          setTimeout(() => {
            updateRefreshing(false);
            updatePull(0);
          }, 400);
        }
      } else {
        updatePull(0);
      }
    };

    const handleTouchCancel = () => {
      // System interrupted the gesture (incoming call, browser chrome, etc.)
      gestureActiveRef.current = false;
      touchStartYRef.current = 0;
      updatePull(0);
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []);

  const indicatorVisible = pullDistance > 0 || isRefreshing;

  return (
    <div ref={containerRef} className="relative w-full min-h-full flex-1">
      {/* Pull Indicator — kept mounted (height 0 / opacity 0 when idle) so it is
          never inserted into or removed from the DOM mid-gesture, which would
          shift layout and disrupt native scrolling on Android Chrome. */}
      <div
        className="pointer-events-none flex items-center justify-center py-2 text-xs font-bold text-slate-500 dark:text-slate-400 transition-all overflow-hidden"
        style={{
          height: `${pullDistance}px`,
          opacity: indicatorVisible ? Math.min(pullDistance / PULL_THRESHOLD, 1) : 0,
        }}
        aria-hidden={!indicatorVisible}
        aria-live={isRefreshing ? "polite" : "off"}
      >
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm px-3 py-1.5 rounded-full">
          <RefreshCw className={`w-4 h-4 text-blue-600 ${isRefreshing ? "animate-spin" : ""}`} />
          <span>{isRefreshing ? "Refreshing data..." : pullDistance >= PULL_THRESHOLD ? "Release to refresh" : "Pull down to refresh"}</span>
        </div>
      </div>
      {children}
    </div>
  );
};
