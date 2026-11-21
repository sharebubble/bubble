import random
from decimal import Decimal

import pytest

from bubble.ledger.rounding import allocate


@pytest.mark.parametrize(
    ("total", "weights", "expected"),
    [
        ("10.00", [1, 1, 1], ["3.34", "3.33", "3.33"]),
        ("60.00", [1, 1, 1, 1], ["15.00", "15.00", "15.00", "15.00"]),
        ("10.00", [1, 0.5], ["6.67", "3.33"]),
        ("0.02", [1, 1, 1], ["0.01", "0.01", "0.00"]),
        ("-10.00", [1, 1, 1], ["-3.34", "-3.33", "-3.33"]),
        ("5.00", [0, 1], ["0.00", "5.00"]),
        ("1.00", [1, 1, 1], ["0.34", "0.33", "0.33"]),
    ],
)
def test_allocate_examples(total, weights, expected):
    parts = allocate(Decimal(total), [Decimal(str(w)) for w in weights])
    assert parts == [Decimal(e) for e in expected]


@pytest.mark.parametrize("seed", range(200))
def test_allocate_always_sums_exactly_and_stays_fair(seed):
    rng = random.Random(seed)  # noqa: S311
    total = Decimal(rng.randint(-100_000, 100_000)) / 100
    weights = [
        Decimal(rng.choice([0, 0.5, 1, 1, 2, 3])) for _ in range(rng.randint(1, 12))
    ]
    if sum(weights) == 0:
        weights[0] = Decimal(1)

    parts = allocate(total, weights)

    assert sum(parts) == total
    assert all(p == p.quantize(Decimal("0.01")) for p in parts)
    weight_sum = sum(weights)
    for part, weight in zip(parts, weights, strict=True):
        exact = total * weight / weight_sum
        # Never more than one cent away from the exact share...
        assert abs(part - exact) < Decimal("0.01")
        # ...and a zero weight never pays anything.
        if weight == 0:
            assert part == 0


@pytest.mark.parametrize(
    ("total", "weights"),
    [
        (Decimal("10.00"), []),
        (Decimal("10.00"), [0, 0]),
        (Decimal("10.00"), [1, -1]),
        (Decimal("10.001"), [1, 1]),
    ],
)
def test_allocate_rejects_invalid_input(total, weights):
    with pytest.raises(ValueError):  # noqa: PT011
        allocate(total, weights)
