import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCheck, Printer, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function DpaPage() {
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
              <FileCheck className="h-6 w-6 text-purple-600" />
              <CardTitle className="text-2xl font-bold tracking-tight">Hosted Data Terms</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Optional hosted instances only • Version 2026.3 • Effective Date: August 22, 2026
            </p>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none py-6 space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">1. Scope</h3>
              <p>
                This page applies only if we host ServeTracker for you. The open-source code on GitHub is software you run yourself. We are not your process server, lawyer, or employer. You remain responsible for your own cases, licenses, and service of process.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">2. Your data</h3>
              <p>
                You own the records in your hosted instance. We process them only to keep that instance running. We do not sell them. We do not use them for skip tracing, ads, or other agencies’ work.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">3. Security (honest)</h3>
              <p>
                Hosted instances use TLS 1.3 in transit (AES-256-GCM on this host), Argon2id password hashes, SHA-256 session and file checksums, role limits, and backups of the kind we use for our own copy. We do not claim SOC 2, ISO 27001, or any other audit certification. The database is not SQLCipher-encrypted at the application layer.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">4. Incidents</h3>
              <p>
                If we confirm unauthorized access to your hosted data, we will tell you as soon as we reasonably can. This is not a certified 72-hour SLA.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
