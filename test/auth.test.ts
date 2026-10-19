import { describe, it, expect } from "vitest";
import { calculateProof, verifyProof } from "../src/auth.js";
import { CANONICAL_AUTH_PROOF_VECTORS } from "../src/types.js";

describe("Web Remote Control HMAC-SHA256 Auth Proof", () => {
  it("matches canonical proof vectors from ZCode protocol specification", () => {
    for (const vector of CANONICAL_AUTH_PROOF_VECTORS) {
      const calculated = calculateProof(
        vector.passHash,
        vector.nonce,
        vector.role,
        vector.deviceSid,
      );
      expect(calculated).toBe(vector.proof);
      expect(verifyProof(vector.proof, calculated)).toBe(true);
    }
  });

  it("fails verification on altered proof or role mismatch", () => {
    const vector = CANONICAL_AUTH_PROOF_VECTORS[0];
    const invalidProof = "invalid_proof_here";
    expect(verifyProof(vector.proof, invalidProof)).toBe(false);

    const wrongRoleProof = calculateProof(
      vector.passHash,
      vector.nonce,
      "terminal", // vector[0] is device
      vector.deviceSid,
    );
    expect(verifyProof(vector.proof, wrongRoleProof)).toBe(false);
  });
});
