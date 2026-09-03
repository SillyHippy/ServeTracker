import { describe, expect, test } from "bun:test";
import {
  includeCaseInList,
  matchesPaymentFilter,
  parsePaymentFilter,
} from "../src/lib/caseFilters";

describe("case billing filters", () => {
  test("active mode hides served/closed even when unpaid", () => {
    expect(includeCaseInList({
      mode: "active",
      status: "Served",
      paymentStatus: "UNPAID",
      paymentFilter: "unpaid",
    })).toBe(false);
    expect(includeCaseInList({
      mode: "active",
      status: "closed",
      paymentStatus: "UNPAID",
      paymentFilter: "all",
    })).toBe(false);
  });

  test("billing mode shows served/closed unpaid and paid", () => {
    expect(includeCaseInList({
      mode: "billing",
      status: "Served",
      paymentStatus: "UNPAID",
      paymentFilter: "unpaid",
    })).toBe(true);
    expect(includeCaseInList({
      mode: "billing",
      status: "closed",
      paymentStatus: "PAID",
      paymentFilter: "paid",
    })).toBe(true);
    expect(includeCaseInList({
      mode: "billing",
      status: "closed",
      paymentStatus: "PAID",
      paymentFilter: "unpaid",
    })).toBe(false);
  });

  test("no_invoice matches blank payment_status only", () => {
    expect(matchesPaymentFilter("", "no_invoice")).toBe(true);
    expect(matchesPaymentFilter("UNPAID", "no_invoice")).toBe(false);
    expect(parsePaymentFilter("unpaid")).toBe("unpaid");
    expect(parsePaymentFilter("bogus")).toBe("all");
  });
});
