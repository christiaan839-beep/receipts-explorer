// A signature check only, not a receipt verifier: it skips the steps of
// VAOS 2.0 section 7 listed beside it on the quickstart page.
import { readFileSync } from "node:fs";
import { loadEd25519PublicKey, verifyEd25519 } from "@sovereignos/verifiable-receipts";

function signatureVerifies(receipt, key) {
  if (typeof receipt.canonical !== "string" || typeof receipt.signature !== "string") return false;
  // Section 7, step 1: the v2= prefix, and no other.
  if (!receipt.signature.startsWith("v2=")) return false;
  // Step 2: canonical base64, the one spelling. Buffer.from skips what is
  // not base64, so the bytes must encode back to exactly the same text.
  const base64 = receipt.signature.slice("v2=".length);
  const signature = Buffer.from(base64, "base64");
  if (signature.toString("base64") !== base64) return false;
  // Step 4: Ed25519 under the strict profile of section 7.3.
  return verifyEd25519(key, Buffer.from(receipt.canonical, "utf8"), signature).ok;
}

const receipt = JSON.parse(readFileSync(process.argv[2] ?? "receipt.json", "utf8"));
const key = loadEd25519PublicKey(readFileSync("ed25519.pem"));
console.log(signatureVerifies(receipt, key));
