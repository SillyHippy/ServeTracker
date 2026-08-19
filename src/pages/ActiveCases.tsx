import React from "react";
import ActiveCasesPanel from "@/components/ActiveCasesPanel";

const ActiveCases: React.FC = () => {
  return (
    <div className="page-container pb-20">
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Active Cases
        </h1>
        <p className="text-slate-500 text-xs md:text-sm">
          Every open job — field sheet, assigned server, and 1-click nudge
        </p>
      </div>
      <ActiveCasesPanel fullPage />
    </div>
  );
};

export default ActiveCases;
