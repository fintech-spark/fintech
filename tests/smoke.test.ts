import { describe, expect, it } from "vitest";
import { z } from "zod";

const setupMarker = z.object({
  name: z.literal("Merchant Brain"),
  productImplementationStarted: z.literal(false),
});

describe("setup foundation", () => {
  it("keeps product work explicitly out of the setup slice", () => {
    expect(
      setupMarker.parse({
        name: "Merchant Brain",
        productImplementationStarted: false,
      }),
    ).toEqual({ name: "Merchant Brain", productImplementationStarted: false });
  });
});
