import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  STAT_BASE_OPTIONS,
  STAT_ITEM_TYPES,
  STAT_KPS_OPTIONS,
} from './statItems';

const toLowerCamelCase = (value: string) =>
  `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

describe('statistics item wire contract', () => {
  it('keeps every UI option accepted by the Rust store', () => {
    const uiTypes = new Set(
      [...STAT_BASE_OPTIONS, ...STAT_KPS_OPTIONS].map(({ value }) => value),
    );
    expect(uiTypes).toEqual(new Set(STAT_ITEM_TYPES));

    const rustSource = readFileSync(
      resolve(process.cwd(), 'src-tauri/src/models/mod.rs'),
      'utf8',
    );
    const declaration = rustSource.match(
      /#\[serde\(rename_all = "camelCase"\)\]\s*pub enum StatType\s*\{([^}]*)\}/,
    );
    expect(declaration, 'Rust StatType declaration').not.toBeNull();

    const rustTypes = new Set(
      [...declaration![1].matchAll(/^\s*([A-Z][A-Za-z0-9]*),\s*$/gm)].map(
        ([, variant]) => toLowerCamelCase(variant),
      ),
    );
    expect(rustTypes).toEqual(uiTypes);
  });
});
