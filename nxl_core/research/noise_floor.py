"""
nxl_core.research.noise_floor
-----------------------------
MAD-based noise floor estimator.

MAD = median(|sample - median(samples)|)
σ ≈ 1.4826 * MAD  (consistent estimator for Gaussian noise)

is_signal(delta, sigma, k=3) returns True when |delta| > k * sigma.
"""
from __future__ import annotations

import statistics

import numpy as np


class MADNoiseFloor:
    """MAD-based noise floor estimator for Gaussian noise."""

    K = 1.4826  # scaling factor for Gaussian consistency

    def estimate(self, samples: np.ndarray) -> float:
        """Estimate σ using MAD of the samples."""
        median = statistics.median(samples)
        mad = statistics.median(np.abs(samples - median))
        return self.K * mad


def is_signal(delta: float, sigma: float, k: float = 3.0) -> bool:
    """Return True when |delta| > k * sigma (strict inequality)."""
    return abs(delta) > k * sigma
