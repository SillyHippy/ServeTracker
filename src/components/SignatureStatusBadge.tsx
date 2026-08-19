import React from "react";
import { Badge } from "@/components/ui/badge";
import { PenLine, CheckCircle2, Ban } from "lucide-react";

interface Props {
  enrolled?: boolean;
  revoked?: boolean;
  updatedAt?: string;
  status?: string | { enrolled?: boolean; revoked?: boolean; updatedAt?: string };
}

/** Compact signature enrollment status pill. */
export const SignatureStatusBadge: React.FC<Props> = ({ enrolled, revoked, updatedAt, status }) => {
  let isEnrolled = !!enrolled;
  let isRevoked = !!revoked;
  let updated = updatedAt;
  if (typeof status === "string") {
    isEnrolled = status === "enrolled";
    isRevoked = status === "revoked";
  } else if (status && typeof status === "object") {
    isEnrolled = !!status.enrolled;
    isRevoked = !!status.revoked;
    updated = updated || status.updatedAt;
  }
  if (isRevoked) {
    return (
      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
        <Ban className="h-3 w-3" /> Signature revoked
      </Badge>
    );
  }
  if (!isEnrolled) {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
        <PenLine className="h-3 w-3" /> Not enrolled
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-1 bg-green-600 hover:bg-green-600">
      <CheckCircle2 className="h-3 w-3" />
      {updated ? `Enrolled ${new Date(updated).toLocaleDateString()}` : "Enrolled"}
    </Badge>
  );
};

export default SignatureStatusBadge;
