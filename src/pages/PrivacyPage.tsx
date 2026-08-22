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
              ServeTracker Platform • Version 2026.1 • Effective Date: August 21, 2026
            </p>
          </CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none py-6 space-y-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">1. Strict Zero-Sale Data Commitment</h3>
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                ServeTracker NEVER sells, rents, leases, or trades client or litigant personal data. We do not partner with data brokers, ad-tech networks, or third-party marketing trackers.
              </p>
              <p>
                All data entered by clients or collected during field attempts is processed solely and exclusively for the preparation, execution, and return of court process in compliance with ABA Model Rules 1.6 & 5.3 and the Gramm-Leach-Bliley Act (15 U.S.C. § 6802(e)(8)).
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">2. Categories of Information Collected</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Account Credentials:</strong> Usernames, salted Argon2id password hashes, license numbers, phone numbers, and authorized e-signatures.</li>
                <li><strong>Litigation Pleadings:</strong> Summonses, petitions, subpoenas, case numbers, and party names submitted by legal clients.</li>
                <li><strong>Attempt Telemetry:</strong> UTC ISO-8601 timestamps, high-precision GPS coordinates, horizontal accuracy radius, and photographic evidence.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">3. Security & EXIF Metadata Protection</h3>
              <p>
                All transmissions use TLS 1.3 transport encryption. Stored databases and documents reside on encrypted volumes. Photographic evidence uploaded during field attempts has public EXIF GPS metadata stripped prior to generating client-facing or public documents, while maintaining raw coordinate records in secured audit logs for judicial evidentiary validation.
              </p>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">4. Data Retention & Destruction</h3>
              <p>
                Case records and evidentiary attempt logs are retained for the statutory duration required to support pending legal claims and court verification. Upon case closure or written instruction from the hiring client, data is archived or permanently deleted.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
