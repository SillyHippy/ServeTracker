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
              <CardTitle className="text-2xl font-bold tracking-tight">Data Processing Agreement (DPA)</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              For Law Firms & Corporate Clients • Version 2026.1 • Effective Date: August 21, 2026
            </p>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none py-6 space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">1. Controller & Processor Designations</h3>
              <p>
                The Law Firm, Corporate Client, or Legal Entity submitting process serving orders is the <strong>Data Controller</strong>. ServeTracker (operated by Just Legal Solutions) acts as the <strong>Data Processor</strong>, processing personal data solely on documented instructions from the Data Controller to execute process serving workflows.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">2. Technical & Organizational Measures (TOMs)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Transport Security:</strong> Strict TLS 1.3 encryption across all API and web sessions.</li>
                <li><strong>Access Control:</strong> Multi-tier RBAC restricting field process servers to assigned cases; client financial terms and unassigned documents are completely inaccessible.</li>
                <li><strong>Encrypted Backups:</strong> Automated daily backups transmitted via TLS 1.3 to off-site cloud storage holding SOC 2 Type II and ISO 27001 certifications.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">3. Non-Disclosure of Unserved Litigants</h3>
              <p>
                Data Processor covenants that unserved litigation documents, summonses, witness subpoenas, and unserved home/employment addresses shall remain strictly confidential, non-indexed, and shielded from third-party data brokers.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">4. 72-Hour Security Incident Notification</h3>
              <p>
                In the event of a confirmed security incident resulting in unauthorized access to unencrypted personal data, Data Processor shall notify Data Controller without undue delay and in any event within seventy-two (72) hours of becoming aware of the incident.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
