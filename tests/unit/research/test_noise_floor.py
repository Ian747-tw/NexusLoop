"""
M0.2 Step 5: MAD-based noise floor estimator.

is_signal(delta, sigma, k=3) returns True when |delta| > k * sigma.
Estimator must be within 10% of true σ on synthetic Gaussian data.
"""
from __future__ import annotations

import statistics

import numpy as np
import pytest

from nxl_core.research.noise_floor import MADNoiseFloor, is_signal


class TestMADNoiseFloor:
    def test_mad_estimator_within_10_percent_of_true_sigma(self) -> None:
        """Estimator within 10% of true σ on synthetic Gaussian data."""
        true_sigma = 2.5
        rng = np.random.default_rng(seed=42)
        samples = rng.normal(loc=0.0, scale=true_sigma, size=1000)

        estimator = MADNoiseFloor()
        estimated_sigma = estimator.estimate(samples)

        relative_error = abs(estimated_sigma - true_sigma) / true_sigma
        assert relative_error <= 0.10, (
            f"Estimated σ={estimated_sigma:.3f} differs from true σ={true_sigma} "
            f"by {relative_error*100:.1f}% (>10%)"
        )

    def test_mad_estimator_on_multiple_runs(self) -> None:
        """Test on 5 independent runs, all within 15% tolerance."""
        true_sigma = 1.5
        tolerance = 0.15
        rng = np.random.default_rng(seed=123)
        estimator = MADNoiseFloor()

        for run in range(5):
            samples = rng.normal(loc=0.0, scale=true_sigma, size=500)
            estimated = estimator.estimate(samples)
            relative_error = abs(estimated - true_sigma) / true_sigma
            assert relative_error <= tolerance, (
                f"Run {run}: σ={estimated:.3f}, true={true_sigma}, "
                f"error={relative_error*100:.1f}% > {tolerance*100:.0f}%"
            )


class TestIsSignal:
    def test_signal_above_threshold(self) -> None:
        """Delta well above k*sigma is a signal."""
        assert is_signal(delta=10.0, sigma=1.0, k=3) is True

    def test_noise_below_threshold(self) -> None:
        """Delta well below k*sigma is not a signal."""
        assert is_signal(delta=1.0, sigma=1.0, k=3) is False

    def test_exactly_at_threshold(self) -> None:
        """Delta exactly at k*sigma is not a signal (strict inequality)."""
        assert is_signal(delta=3.0, sigma=1.0, k=3) is False

    def test_negative_delta(self) -> None:
        """Absolute value used, so negative delta same as positive."""
        assert is_signal(delta=-10.0, sigma=1.0, k=3) is True
        assert is_signal(delta=-1.0, sigma=1.0, k=3) is False

    def test_default_k_is_3(self) -> None:
        """Default k=3."""
        assert is_signal(delta=3.0, sigma=1.0) is False
        assert is_signal(delta=3.1, sigma=1.0) is True
