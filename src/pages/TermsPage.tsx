import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Printer, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/login" className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Login
          </Link>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>

        <Card className="border shadow-sm">
          <CardHeader className="border-b pb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
              <CardTitle className="text-2xl font-bold tracking-tight">Terms of Service</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ServeTracker Platform • Version 2026.3 • Effective Date: August 22, 2026
            </p>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none py-6 space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">1. What ServeTracker Is</h3>
              <p>
                ServeTracker is software for logging and tracking process-serving work: cases, attempts, documents, and related records. It is not a law firm, not a process-serving agency, and not a substitute for any user’s own service contract, website terms, license, or bond. Each agency or server is responsible for their own process-serving terms, pricing, and statutory duties.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">2. Acceptable Use</h3>
              <p>
                You may use ServeTracker only to keep accurate records for work you are authorized to perform. Do not upload or share data you are not allowed to handle. Do not attempt to access another user’s account or tamper with stored records.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">3. Confidentiality of Records</h3>
              <p>
                Case files, addresses, and unserved documents stored in the app are confidential. Users shall not disclose or sell that information except as needed to do their own authorized work or as required by law or court order.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">4. No Warranty; No Software Liability</h3>
              <p>
                ServeTracker is provided “AS IS” and “AS AVAILABLE,” with no warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, uptime, or accuracy of stored records. To the maximum extent permitted by law, the operator has no liability for any damages arising from use of the software — including lost data, lost profits, missed deadlines, failed or defective service of process, or consequential, incidental, special, or punitive damages — even if advised of the possibility. Where a court will not enforce a total waiver, any remaining software liability is $0. Nothing in this section waives liability that Oklahoma law does not allow to be waived (including fraud or willful misconduct). This Agreement is governed by the laws of the State of Oklahoma, with venue in Tulsa County District Court.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
