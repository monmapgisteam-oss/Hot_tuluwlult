import type { Inputs } from "./urban";

/** Concept layout dimensions follow the actual neighbourhood footprint. These
 * are layout defaults, not substitutes for road or building code checks. */
export function settlementScale(input: Inputs, areaM2: number, narrowSpan: number): Inputs {
  const ha = areaM2 / 10000;
  // Polygon projection/intersection introduces tiny area errors at thresholds.
  const small = ha <= 12 + 1e-6, medium = ha <= 40 + 1e-6, district = ha <= 100 + 1e-6;
  const arterial = small ? 20 : medium ? 24 : district ? 30 : input.arterialW;
  const collector = small ? 16 : medium ? 18 : district ? 24 : input.collectorW;
  const local = small ? 12 : medium ? 14 : district ? 16 : input.localW;
  return {
    ...input,
    arterialW: Math.min(input.arterialW, arterial),
    collectorW: Math.min(input.collectorW, collector),
    localW: Math.min(input.localW, local),
    artLanes: Math.min(input.artLanes ?? 2, medium ? 1 : district ? 2 : input.artLanes ?? 2),
    serviceW: district ? 0 : input.serviceW,
    ringOn: !medium && input.ringOn,
    windbreak: Math.min(input.windbreak, Math.max(4, Math.min(narrowSpan * 0.06, Math.sqrt(areaM2) * 0.035))),
    gridStep: Math.min(input.gridStep, Math.max(120, Math.sqrt(areaM2) * 0.55)),
    resBlock: Math.min(input.resBlock, Math.max(4000, areaM2 * 0.12)),
    comBlock: Math.min(input.comBlock, Math.max(2000, areaM2 * 0.06)),
    minW: Math.min(input.minW, Math.max(35, narrowSpan * 0.2)),
  };
}
