from app.services.overview import _compute_health


def test_perfect_repo():
    health, warnings = _compute_health(
        avg_complexity=3.0, cycle_count=0, largest_pkg_size=10, high_cx=[], high_fan_out=[]
    )
    assert health["score"] == 100
    assert health["stars"] == 5
    assert health["label"] == "Excellent"
    assert warnings == []


def test_cycles_deduct_and_warn():
    health, warnings = _compute_health(2.0, 2, 5, [], [])
    assert health["score"] == 80
    assert any("circular" in w for w in warnings)


def test_cycle_deduction_capped_at_30():
    health, _ = _compute_health(2.0, 10, 5, [], [])
    assert health["score"] == 70


def test_avg_complexity_deductions():
    high, _ = _compute_health(11.0, 0, 5, [], [])
    mid, _ = _compute_health(8.0, 0, 5, [], [])
    low, _ = _compute_health(5.0, 0, 5, [], [])
    assert high["score"] == 85
    assert mid["score"] == 95
    assert low["score"] == 100


def test_large_package_deductions():
    huge, warnings = _compute_health(2.0, 0, 35, [], [])
    big, _ = _compute_health(2.0, 0, 25, [], [])
    assert huge["score"] == 90
    assert big["score"] == 95
    assert any("package" in w.lower() for w in warnings)


def test_high_complexity_warnings():
    _, warnings = _compute_health(2.0, 0, 5, [{"name": "God.method", "complexity": 21}], [])
    assert any("God.method" in w and "21" in w for w in warnings)


def test_fan_out_warnings():
    _, warnings = _compute_health(2.0, 0, 5, [], [{"name": "Hub", "fan_out": 30}])
    assert any("Hub" in w for w in warnings)


def test_score_floor_and_labels():
    health, _ = _compute_health(15.0, 10, 40, [], [])
    assert health["score"] >= 0
    assert health["label"] in ("Excellent", "Good", "Fair", "Poor", "Critical")
    assert 1 <= health["stars"] <= 5
