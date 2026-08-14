export interface Slab {
  lower_annual_minor: number;
  fixed_annual_minor: number;
  rate_bp: number;
}

export function computeAnnualTax(annualTaxableMinor: number, slabs: Slab[]): number {
  if (annualTaxableMinor <= 0 || slabs.length === 0) return 0;
  const applicable = slabs
    .filter((s) => s.lower_annual_minor <= annualTaxableMinor)
    .sort((a, b) => b.lower_annual_minor - a.lower_annual_minor)[0];
  if (!applicable) return 0;
  return (
    applicable.fixed_annual_minor +
    Math.round(((annualTaxableMinor - applicable.lower_annual_minor) * applicable.rate_bp) / 10_000)
  );
}
