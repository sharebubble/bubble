"""The one rounding rule of the ledger: largest-remainder allocation.

Splitting 10.00 three ways must produce 3.34 / 3.33 / 3.33, never 3.33 three
times (one cent lost) or 3.34 three times (one cent invented). Every split in
the ledger goes through ``allocate`` so the parts always add up exactly.
"""

from collections.abc import Sequence
from decimal import ROUND_FLOOR, Decimal

CENT = Decimal("0.01")


def allocate(
    total: Decimal, weights: Sequence[Decimal | int], quantum: Decimal = CENT
) -> list[Decimal]:
    """Split ``total`` proportionally to ``weights`` into parts of ``quantum``.

    Each exact share is floored to the quantum; the units left over go one by
    one to the shares with the largest fractional remainders, ties broken by
    position. The result always sums to exactly ``total``.

    Works for negative totals too (the parts are negated as a whole), and a
    zero weight always gets zero.
    """
    if not weights:
        msg = "allocate() needs at least one weight"
        raise ValueError(msg)
    weights = [Decimal(w) for w in weights]
    if any(w < 0 for w in weights):
        msg = "weights must not be negative"
        raise ValueError(msg)
    weight_sum = sum(weights)
    if weight_sum == 0:
        msg = "at least one weight must be positive"
        raise ValueError(msg)
    if total.quantize(quantum) != total:
        msg = f"total {total} is not a whole multiple of {quantum}"
        raise ValueError(msg)

    if total < 0:
        return [-part for part in allocate(-total, weights, quantum)]

    exact = [total * w / weight_sum for w in weights]
    floored = [share.quantize(quantum, rounding=ROUND_FLOOR) for share in exact]
    leftover_units = int((total - sum(floored)) / quantum)
    # Largest remainder first; the stable sort keeps earlier positions first on ties.
    order = sorted(
        range(len(weights)), key=lambda i: exact[i] - floored[i], reverse=True
    )
    for i in order[:leftover_units]:
        floored[i] += quantum
    return floored
