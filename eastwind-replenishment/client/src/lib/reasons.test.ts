import { describe, expect, it } from 'vitest';
import { orderReasons, shortEventName } from './reasons';

describe('orderReasons', () => {
  it('turns the hero line into plain words, strongest first', () => {
    expect(
      orderReasons(
        '+5 units from holiday timing · Mid-Autumn Festival 2026 in 3 weeks · Forecast 15.9x recent weekly sales · Stock covers 0.2 of 3 weeks needed'
      )
    ).toEqual([
      'Mid-Autumn in 3 weeks – forecast 15.9× recent sales',
      'Stock covers 0.2 of the 3 weeks needed',
      'Holiday timing adds 5 units',
    ]);
  });

  it('never shows a driver that moves the forecast by zero units, or a 0% change', () => {
    const reasons = orderReasons(
      '+0 units from holiday timing · -0 units from recent trend · Forecast 0% vs last 4 weeks · Capped by 14-day shelf life'
    );
    expect(reasons).toEqual(['Capped to what sells within the 14-day shelf life']);
    expect(reasons.join(' ')).not.toMatch(/\b0 units/);
  });

  it('orders non-zero drivers by size and words negative ones as removals', () => {
    expect(
      orderReasons('-12 units from recent trend · +3 units from last year · +40 units from store-product baseline')
    ).toEqual(['Store baseline adds 40 units', 'Recent trend removes 12 units', 'Last year’s sales adds 3 units']);
  });

  it('handles a percentage change and an empty explanation', () => {
    expect(orderReasons('Forecast 18% vs last 4 weeks')).toEqual(['Forecast +18% vs the last 4 weeks']);
    expect(orderReasons(null)).toEqual([]);
    expect(shortEventName('Lunar New Year 2026')).toBe('Lunar New Year');
  });
});
