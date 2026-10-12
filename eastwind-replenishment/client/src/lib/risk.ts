import type { Risk } from './api';

/**
 * Plain-language order status for the model's stockout_risk flag. HIGH means stock on hand + inbound is below
 * expected demand until the next delivery: it needs an order to avoid a stockout, not that a stockout is likely.
 */
export const STOCK_STATUS: Record<Risk, { label: string; hint: string; tone: 'critical' | 'warning' | 'good' }> = {
  HIGH: {
    label: 'Order needed',
    hint: 'Needs an order to avoid a stockout: stock + inbound is below demand until the next delivery',
    tone: 'critical',
  },
  MEDIUM: {
    label: 'Below safety stock',
    hint: 'Covers expected demand, but not the safety buffer for a demand spike',
    tone: 'warning',
  },
  LOW: { label: 'Covered', hint: 'Stock + inbound covers demand and safety stock', tone: 'good' },
};

export const EXPIRY_STATUS: Record<Risk, { label: string; hint: string }> = {
  HIGH: { label: 'Expiry risk', hint: 'More stock than can sell before it expires' },
  MEDIUM: { label: 'Over 6 weeks cover', hint: 'Stock exceeds 6 weeks of forecast demand' },
  LOW: { label: '', hint: '' },
};
