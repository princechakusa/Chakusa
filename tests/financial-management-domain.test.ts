import { describe, expect, it } from "vitest";
import {
  computeMileageAmount,
  DEFAULT_EXPENSE_CATEGORIES,
  summariseFinancials,
  toCategorySlug,
} from "../src/lib/financial/financial.domain.js";

describe("toCategorySlug", () => {
  it("lowercases and hyphenates", () => {
    expect(toCategorySlug("Software and subscriptions")).toBe("software-and-subscriptions");
  });
  it("strips accents and punctuation", () => {
    expect(toCategorySlug("  Café / Meals!! ")).toBe("cafe-meals");
  });
  it("returns empty string when nothing is sluggable", () => {
    expect(toCategorySlug("!!! ??? ")).toBe("");
  });
  it("caps length without leaving a trailing hyphen", () => {
    const slug = toCategorySlug("a".repeat(80));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
  it("keeps the default categories sluggable and unique", () => {
    const slugs = DEFAULT_EXPENSE_CATEGORIES.map(toCategorySlug);
    expect(slugs.every(Boolean)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("computeMileageAmount", () => {
  it("returns null without a rate", () => {
    expect(computeMileageAmount({ distance: 42, ratePerUnit: null })).toBeNull();
  });
  it("multiplies distance by the rate at 2dp", () => {
    expect(computeMileageAmount({ distance: "12.5", ratePerUnit: "0.4500" })).toBe("5.63");
  });
  it("treats a zero rate as recorded money (0.00), not absent", () => {
    expect(computeMileageAmount({ distance: 100, ratePerUnit: 0 })).toBe("0.00");
  });
});

describe("summariseFinancials", () => {
  it("nets settled revenue against refunds and ignores pending/failed", () => {
    const summary = summariseFinancials({
      revenueRows: [
        { status: "paid", amount: "100.00", refundedAmount: "0", currency: "usd" },
        { status: "partially_refunded", amount: "80.00", refundedAmount: "30.00", currency: "USD" },
        { status: "pending", amount: "999.00", refundedAmount: "0", currency: "USD" },
        { status: "failed", amount: "999.00", refundedAmount: "0", currency: "USD" },
      ],
      expenseRows: [],
      mileageRows: [],
      outstandingRows: [],
    });
    expect(summary.currencies).toHaveLength(1);
    expect(summary.currencies[0]).toMatchObject({ currency: "USD", revenue: "150.00" });
  });

  it("keeps currencies separate and never adds across them", () => {
    const summary = summariseFinancials({
      revenueRows: [
        { status: "paid", amount: "100.00", refundedAmount: "0", currency: "USD" },
        { status: "paid", amount: "200.00", refundedAmount: "0", currency: "EUR" },
      ],
      expenseRows: [
        { amount: "40.00", currency: "USD", categoryId: "c1", categoryName: "Supplies" },
        { amount: "10.00", currency: "EUR", categoryId: null, categoryName: null },
      ],
      mileageRows: [{ amount: "5.00", currency: "USD" }, { amount: null, currency: null }],
      outstandingRows: [{ outstandingBalance: "25.00", currency: "USD" }],
    });
    const [eur, usd] = summary.currencies;
    expect(eur).toMatchObject({ currency: "EUR", revenue: "200.00", expenses: "10.00", net: "190.00", outstanding: "0.00" });
    expect(usd).toMatchObject({ currency: "USD", revenue: "100.00", expenses: "40.00", mileage: "5.00", net: "55.00", outstanding: "25.00" });
  });

  it("breaks expenses down by category, largest first, uncategorised labelled", () => {
    const summary = summariseFinancials({
      revenueRows: [],
      expenseRows: [
        { amount: "10.00", currency: "USD", categoryId: "c1", categoryName: "Supplies" },
        { amount: "70.00", currency: "USD", categoryId: "c2", categoryName: "Rent" },
        { amount: "5.00", currency: "USD", categoryId: null, categoryName: null },
      ],
      mileageRows: [],
      outstandingRows: [],
    });
    expect(summary.currencies[0]?.expensesByCategory).toEqual([
      { categoryId: "c2", name: "Rent", amount: "70.00" },
      { categoryId: "c1", name: "Supplies", amount: "10.00" },
      { categoryId: null, name: "Uncategorised", amount: "5.00" },
    ]);
  });

  it("allows a negative net when spend exceeds revenue", () => {
    const summary = summariseFinancials({
      revenueRows: [{ status: "paid", amount: "50.00", refundedAmount: "0", currency: "USD" }],
      expenseRows: [{ amount: "120.00", currency: "USD", categoryId: null, categoryName: null }],
      mileageRows: [{ amount: "15.00", currency: "USD" }],
      outstandingRows: [],
    });
    expect(summary.currencies[0]?.net).toBe("-85.00");
  });

  it("clamps a negative outstanding balance to zero", () => {
    const summary = summariseFinancials({
      revenueRows: [],
      expenseRows: [],
      mileageRows: [],
      outstandingRows: [{ outstandingBalance: "-40.00", currency: "USD" }],
    });
    expect(summary.currencies[0]?.outstanding).toBe("0.00");
  });
});
