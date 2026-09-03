import React from "react";
import { useSearchParams } from "react-router-dom";
import ActiveCasesPanel from "@/components/ActiveCasesPanel";
import { parsePaymentFilter, type PaymentFilter } from "@/lib/caseFilters";

const Billing: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const paymentFilter = parsePaymentFilter(params.get("filter"));

  const setPaymentFilter = (filter: PaymentFilter) => {
    const next = new URLSearchParams(params);
    if (filter === "all") next.delete("filter");
    else next.set("filter", filter);
    setParams(next, { replace: true });
  };

  return (
    <div className="page-container pb-20">
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Billing (A/R)
        </h1>
        <p className="text-slate-500 text-xs md:text-sm">
          Unpaid, paid, and uninvoiced jobs — including served and closed cases
        </p>
      </div>
      <ActiveCasesPanel
        fullPage
        mode="billing"
        paymentFilter={paymentFilter}
        onPaymentFilterChange={setPaymentFilter}
      />
    </div>
  );
};

export default Billing;
