// =============================================================================
// Profit calculation
// =============================================================================
// Same formula the frontend uses, server-side now. Single source of truth.
// =============================================================================

const FEE_RATE = 0.129; // eBay final value fee, standard category

/**
 * Compute profit, ROI, and verdict from raw eBay/Amazon prices.
 */
export function calculateProfit({ ebayPrice, amazonPrice, shipping = 8, packaging = 3 }) {
  const fees = ebayPrice * FEE_RATE;
  const profit = ebayPrice - amazonPrice - fees - shipping - packaging;
  const roi = amazonPrice > 0 ? (profit / amazonPrice) * 100 : 0;

  return {
    fees: round(fees),
    shipping,
    packaging,
    profit: round(profit),
    roi: round(roi, 1),
    ...verdict(roi),
  };
}

function verdict(roi) {
  if (roi >= 50) return { verdictLabel: '🚀 Premium opportunity', verdictClass: 'excellent' };
  if (roi >= 30) return { verdictLabel: '✓ Excellent — list it', verdictClass: 'excellent' };
  if (roi >= 20) return { verdictLabel: '✓ Good opportunity', verdictClass: 'good' };
  if (roi >= 10) return { verdictLabel: '⚠ Marginal — needs volume', verdictClass: 'medium' };
  return { verdictLabel: '✗ Skip — ROI too low', verdictClass: 'poor' };
}

function round(n, dp = 2) {
  return Number(n.toFixed(dp));
}
