import { describe, it, expect } from 'vitest';
import { passesHardFilters, inventoryFitScore, type HardFilterUnit } from './matching';
import { emptyQualification } from './qualification';

function q(o: Partial<ReturnType<typeof emptyQualification>>) {
  return { ...emptyQualification(), ...o };
}
const unit = (o: Partial<HardFilterUnit> = {}): HardFilterUnit => ({
  bhk: 2,
  priceMin: 6000000,
  priceMax: 8000000,
  location: 'Wakad',
  isAvailable: true,
  ...o,
});

describe('passesHardFilters', () => {
  it('matches a well-fitting unit', () => {
    expect(passesHardFilters(unit(), q({ bhk: 2, budget_max: 8000000, locations: ['Wakad'] }))).toBe(true);
  });
  it('rejects unavailable units', () => {
    expect(passesHardFilters(unit({ isAvailable: false }), q({ bhk: 2 }))).toBe(false);
  });
  it('rejects a BHK mismatch', () => {
    expect(passesHardFilters(unit({ bhk: 3 }), q({ bhk: 2 }))).toBe(false);
  });
  it('rejects a unit priced well above budget', () => {
    expect(passesHardFilters(unit({ priceMin: 12000000 }), q({ budget_max: 8000000 }))).toBe(false);
  });
  it('allows a small stretch over budget', () => {
    expect(passesHardFilters(unit({ priceMin: 8500000, priceMax: 9000000 }), q({ budget_max: 8000000 }))).toBe(true);
  });
  it('rejects a location mismatch when the lead named locations', () => {
    expect(passesHardFilters(unit({ location: 'Baner' }), q({ locations: ['Wakad'] }))).toBe(false);
  });
  it('ignores unspecified criteria', () => {
    expect(passesHardFilters(unit(), q({ intent: 'buy' }))).toBe(true);
  });
});

describe('inventoryFitScore', () => {
  it('is 0 with no matches and 1 with 3+', () => {
    expect(inventoryFitScore(0)).toBe(0);
    expect(inventoryFitScore(3)).toBe(1);
    expect(inventoryFitScore(5)).toBe(1);
  });
  it('scales between', () => {
    expect(inventoryFitScore(1)).toBeGreaterThan(0);
    expect(inventoryFitScore(2)).toBeGreaterThan(inventoryFitScore(1));
  });
});
