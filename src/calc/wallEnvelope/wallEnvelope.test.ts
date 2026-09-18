import { describe, expect, it } from "vitest";
import {
  computeWallEnvelopeZone,
  displayWallEnvelopeProfileName,
  findWallEnvelopeProfiles,
} from "./wallEnvelope";

describe("wall envelope Excel catalogue", () => {
  it("keeps the original profile mass and exposes the source row", () => {
    const rows = findWallEnvelopeProfiles({
      height_mm: 145,
      thickness_mm: 1.2,
      material: "МП390",
      insulation_mm: 0,
      family: "ПП",
      sectionType: "]",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].massSection_kg_m).toBeCloseTo(2.1378, 6);
    expect(rows[0].capacity_X).toBeGreaterThan(0);
    expect(displayWallEnvelopeProfileName(rows[0].profile)).toContain("ПП 145x45x1,2");
  });

  it("reproduces the transparent Excel-style row and mass formulas", () => {
    const profile = findWallEnvelopeProfiles({
      height_mm: 145,
      thickness_mm: 1.2,
      material: "МП390",
      insulation_mm: 0,
      family: "ПП",
      sectionType: "]",
    })[0];
    const takeoff = computeWallEnvelopeZone(
      {
        length_m: 30,
        height_m: 4,
        step_mm: 1000,
        framePitch_m: 6,
        wallCount: 2,
        edgeRowCorrection: 0,
      },
      profile,
    );
    expect(takeoff.rows).toBe(4);
    expect(takeoff.profileLength_m).toBe(240);
    expect(takeoff.profileMass_kg).toBeCloseTo(513.072, 6);
  });
});
