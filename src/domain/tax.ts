/**
 * Income tax from owner-configured slabs.
 *
 * The app ships **zero** slab data. Tax brackets change every year and vary by
 * jurisdiction, so hardcoding a tax year's rates would be wrong the moment it
 * shipped and is not something this app should assert. With no slabs configured
 * the function returns 0 and tax is simply a manual deduction line the
 * accountant dictates.
 *
 * A slab is "from this annual income, pay `fixed` plus `rate` of the excess" —
 * the shape used by Pakistan's FBR salary slabs among many others.
 */
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
