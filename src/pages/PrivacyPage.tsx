import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Printer, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function PrivacyPage() {
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
              <Lock className="h-6 w-6 text-emerald-600" />
              <CardTitle className="text-2xl font-bold tracking-tight">Privacy Policy</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ServeTracker Platform • Version 2026.3 • Effective Date: August 22, 2026
            </p>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none py-6 space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">1. What this covers</h3>
              <p>
                This policy applies only when you use a ServeTracker instance we host. If you download the open-source code and run it yourself, we do not receive your data and this policy does not apply to that copy.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">2. What we collect on a hosted instance</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Account info you enter (name, username, email, password hash).</li>
                <li>Case, attempt, document, and photo records you or your users upload.</li>
                <li>Technical logs needed to run the service (IP, timestamps, error logs).</li>
              </ul>
              <p>
                We do not sell, rent, or trade that data. Payments, if any, are handled by a third-party processor (for example Helcim). We do not store card numbers.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">3. How it is used and stored</h3>
              <p>
                Data is used only to operate the hosted app you asked us to run. We do not claim SOC 2, ISO 27001, or any other formal certification. Hosted copies sit on the same class of server we use for our own work.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">4. Retention and deletion</h3>
              <p>
                We keep hosted data while your instance is active. If you close the instance or ask in writing, we delete or hand back what we reasonably can. Backups may linger for a short period, then are overwritten.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
