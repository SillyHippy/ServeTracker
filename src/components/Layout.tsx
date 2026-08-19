import React from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface LayoutProps {
  className?: string;
}

const Layout: React.FC<LayoutProps> = ({ className }) => {
  const isMobile = useIsMobile();

  return (
    <div className="bg-background w-full min-w-0 max-w-full">
      <Header />
      <main
        className={cn(
          "pb-28 w-full min-w-0 max-w-full",
          isMobile ? "pt-2 px-4" : "page-container",
          className
        )}
      >
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
