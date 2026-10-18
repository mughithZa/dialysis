import { describe, expect, it } from 'vitest';
import { isHeparin } from './api';

describe('isHeparin', () => {
  it('matches any item name containing heparin, ignoring case and spaces', () => {
    for (const name of ['Heparin', '  heparin ', 'Heparin sodium', 'Low-molecular HEPARIN 5000 IU']) {
      expect(isHeparin(name), name).toBe(true);
    }
    for (const name of ['Saline', 'Hepatitis B vaccine', 'Hepari']) {
      expect(isHeparin(name), name).toBe(false);
    }
  });
});
