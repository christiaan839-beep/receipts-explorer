from pathlib import Path

from sovereign_matrix.verifiable_receipts import parse_receipt, verify_v2_receipt

receipt = parse_receipt(Path("receipt.json").read_text(encoding="utf-8"))
result = verify_v2_receipt(receipt, Path("ed25519.pem").read_bytes())
print(result.ok, result.reason)
