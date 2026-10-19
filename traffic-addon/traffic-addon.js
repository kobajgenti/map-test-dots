/**
 * Borbalo Traffic Add-On Layer Generator & Runtime Controller (v2.1)
 *
 * Calibrated from:
 * - MASTER-TRAFFIC-RECREATION.html#navigation-modes (Google Maps GM-01..GM-08, GR-01..GR-05 & Yandex Maps/Navigator YX-M01..YX-M07)
 * - Borbalo Production Map Styles (browse & drive, day & night, EN & KA road pavement width curves z5..z20 & 7 z-level decks z=-1..5)
 * - Key Design Rules:
 *   1. 100% Solid Colours (`line-opacity: 1` everywhere — zero transparent colours or alpha stacking at vertices).
 *      Subordinate hierarchy in `drive` / `drive-guidance` and `tunnel` decks is achieved via pre-composited solid hex colours.
 *   2. Instant (direct) disappearance of smaller streets when zooming out via top-level `["step", ["zoom"], ...]` in `filter` (zero fade-out).
 *   3. Bold Google-style low-zoom prominence (`z5..z13`) + merged overview corridors (`zoom_band: 6, 8, 10, 12`),
 *      transitioning at `z14..z20` to pavement-contained directional lanes that match Borbalo's exact `georgia.pmtiles` road geometry.
 *   4. Full 7-Deck Z-Level Interleaving (`z = -1, 0, 1, 2, 3, 4, 5`) so bridges/overpasses draw cleanly over ground traffic and ground roads draw over tunnel traffic.
 */

export const DEFAULT_TRAFFIC_TILEJSON_URL = 'https://api.borbalo.ge/nav/traffic/tiles/traffic.json';

/**
 * Helper to blend two `#RRGGBB` hex colours into a 100% solid `#RRGGBB` hex colour (`t = 1` -> pure fg, `t = 0` -> pure bg).
 * Used at build/definition time so all runtime MapLibre layers use 100% opaque `#RRGGBB` strings (`line-opacity: 1`).
 */
function blendHex(fgHex, bgHex, t) {
  const parse = hex => {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(fgHex);
  const [r2, g2, b2] = parse(bgHex);
  const mix = (a, b) => Math.round(b + (a - b) * t).toString(16).padStart(2, '0');
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`.toUpperCase();
}

function buildSolidModeSubPalettes(baseThemeColors, surfaceHex) {
  // Pre-composited solid hex colours (`line-opacity: 1`) for Browse, Drive Preview, Drive Guidance, and Tunnel decks
  const makeVariant = (weights, casingWeights) => ({
    free: blendHex(baseThemeColors.free, surfaceHex, weights.free),
    moderate: blendHex(baseThemeColors.moderate, surfaceHex, weights.moderate),
    heavy: blendHex(baseThemeColors.heavy, surfaceHex, weights.heavy),
    severe: blendHex(baseThemeColors.severe, surfaceHex, weights.severe),
    standstill: blendHex(baseThemeColors.standstill, surfaceHex, weights.standstill),
    casing: {
      free: blendHex(baseThemeColors.casing.free, surfaceHex, casingWeights.free),
      moderate: blendHex(baseThemeColors.casing.moderate, surfaceHex, casingWeights.moderate),
      heavy: blendHex(baseThemeColors.casing.heavy, surfaceHex, casingWeights.heavy),
      severe: blendHex(baseThemeColors.casing.severe, surfaceHex, casingWeights.severe),
      standstill: blendHex(baseThemeColors.casing.standstill, surfaceHex, casingWeights.standstill),
    },
    routeFree: baseThemeColors.routeFree,
    routeCasing: baseThemeColors.routeCasing,
  });

  return {
    ...baseThemeColors,
    modes: {
      browse: makeVariant(
        { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0, standstill: 1.0 },
        { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0, standstill: 1.0 },
      ),
      drive: makeVariant(
        { free: 0.56, moderate: 0.78, heavy: 0.86, severe: 0.92, standstill: 0.95 },
        { free: 0.50, moderate: 0.70, heavy: 0.80, severe: 0.86, standstill: 0.90 },
      ),
      'drive-guidance': makeVariant(
        { free: 0.36, moderate: 0.56, heavy: 0.68, severe: 0.78, standstill: 0.84 },
        { free: 0.32, moderate: 0.50, heavy: 0.62, severe: 0.72, standstill: 0.78 },
      ),
      tunnel: makeVariant(
        { free: 0.62, moderate: 0.68, heavy: 0.74, severe: 0.80, standstill: 0.84 },
        { free: 0.55, moderate: 0.60, heavy: 0.66, severe: 0.72, standstill: 0.76 },
      ),
    },
  };
}

/**
 * 100% Solid (`#RRGGBB`) Colour Palettes for Day and Night themes.
 * - `google`: Google Maps Reference (GM-01..GM-08, GR-01..GR-05) — vibrant emerald green, amber, coral-orange, crimson, dark-berry standstill.
 * - `borbalo`: Borbalo Native 5-tier palette — signature teal/amber/orange/crimson/maroon with high-contrast casings.
 * - `yandex`: Yandex Maps / Navigator Reference (YX-M01..YX-M07).
 */
export const TRAFFIC_PALETTES = Object.freeze({
  borbalo: {
    id: 'borbalo',
    label: 'Borbalo Native (Solid 5-Tier)',
    day: buildSolidModeSubPalettes({
      free: '#00C6BE',
      moderate: '#FFBA00',
      heavy: '#FF7B18',
      severe: '#E52520',
      standstill: '#B81D24',
      casing: {
        free: '#005F5B',
        moderate: '#7A5700',
        heavy: '#7D3805',
        severe: '#68100D',
        standstill: '#4A090D',
      },
      routeFree: '#10BFB6',
      routeCasing: '#057D77',
    }, '#E4E7EC'),
    night: buildSolidModeSubPalettes({
      free: '#3EC2B8',
      moderate: '#F5CC1B',
      heavy: '#FF852B',
      severe: '#E63939',
      standstill: '#B5222E',
      casing: {
        free: '#194E4B',
        moderate: '#6B5808',
        heavy: '#753609',
        severe: '#631515',
        standstill: '#450B11',
      },
      routeFree: '#16C8BF',
      routeCasing: '#055C61',
    }, '#222834'),
  },
  google: {
    id: 'google',
    label: 'Google Maps Reference (Solid)',
    day: buildSolidModeSubPalettes({
      free: '#42CF87',
      moderate: '#FBC532',
      heavy: '#E65C50',
      severe: '#C93438',
      standstill: '#B82D43',
      casing: {
        free: '#1E7A4A',
        moderate: '#8A6200',
        heavy: '#7C231B',
        severe: '#5E1216',
        standstill: '#4A0E19',
      },
      routeFree: '#4285F4',
      routeCasing: '#185ABC',
    }, '#E4E7EC'),
    night: buildSolidModeSubPalettes({
      free: '#34B374',
      moderate: '#E5B229',
      heavy: '#E05246',
      severe: '#C43238',
      standstill: '#B82D43',
      casing: {
        free: '#154D31',
        moderate: '#634A06',
        heavy: '#631D17',
        severe: '#541115',
        standstill: '#480E18',
      },
      routeFree: '#669DF6',
      routeCasing: '#174EA6',
    }, '#222834'),
  },
  yandex: {
    id: 'yandex',
    label: 'Yandex Navigator Reference (Solid)',
    day: buildSolidModeSubPalettes({
      free: '#66C32E',
      moderate: '#F5B800',
      heavy: '#EE4B2B',
      severe: '#C92A2A',
      standstill: '#8E1B1B',
      casing: {
        free: '#2E6110',
        moderate: '#7A5A00',
        heavy: '#751B0A',
        severe: '#5C1010',
        standstill: '#3D0808',
      },
      routeFree: '#66C32E',
      routeCasing: '#2B5B0E',
    }, '#E4E7EC'),
    night: buildSolidModeSubPalettes({
      free: '#55B026',
      moderate: '#E6AC00',
      heavy: '#E04324',
      severe: '#BA2525',
      standstill: '#9E2222',
      casing: {
        free: '#224A0D',
        moderate: '#614700',
        heavy: '#5E1709',
        severe: '#520E0E',
        standstill: '#400A0A',
      },
      routeFree: '#55B026',
      routeCasing: '#20450C',
    }, '#222834'),
  },
});

/**
 * Navigation Mode Profiles (`#navigation-modes` in MASTER-TRAFFIC-RECREATION.html):
 * Note: All layers render at `line-opacity: 1` (zero transparency).
 * Subordinate hierarchy in `drive` and `drive-guidance` is achieved via solid pre-composited hex colours
 * (`TRAFFIC_PALETTES[palette][theme].modes[navigationMode]`) and slight width scaling.
 */
export const NAVIGATION_MODE_PROFILES = Object.freeze({
  browse: {
    id: 'browse',
    label: 'Browse Mode (Primary Network Overlay · 100% Solid)',
    excludeOnRoute: false,
    widthScale: 1.0,
    offsetScale: 1.0,
    day: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
    },
    night: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
    },
  },
  drive: {
    id: 'drive',
    label: 'Drive / Route Preview (Solid Pre-Composited Context + Dominant Route)',
    excludeOnRoute: true,
    widthScale: 0.94,
    offsetScale: 1.0,
    day: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 0.56, moderate: 0.78, heavy: 0.86, severe: 0.92 },
    },
    night: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 0.56, moderate: 0.78, heavy: 0.86, severe: 0.92 },
    },
  },
  'drive-guidance': {
    id: 'drive-guidance',
    label: 'Active Turn-by-Turn Guidance (Solid Muted Off-Route Context)',
    excludeOnRoute: true,
    widthScale: 0.88,
    offsetScale: 1.0,
    day: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 0.36, moderate: 0.56, heavy: 0.68, severe: 0.78 },
    },
    night: {
      coreOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      casingOpacityBySeverity: { free: 1.0, moderate: 1.0, heavy: 1.0, severe: 1.0 },
      solidBlendWeights: { free: 0.36, moderate: 0.56, heavy: 0.68, severe: 0.78 },
    },
  },
});

/**
 * Reference Borbalo road pavement widths (in CSS pixels) from `prod-browse-day-en.json` and `prod-drive-day-en.json`.
 * Used for pavement-containment verification ($d(z) + w(z)/2 < W_{\text{pavement}}(z)/2$).
 */
export const BORBALO_PAVEMENT_WIDTH_STOPS = Object.freeze({
  1: { 5: 1.42, 6: 2.88, 7: 2.25, 8: 2.95, 9: 3.65, 10: 4.25, 11: 4.6, 12: 4.9, 13: 4.72, 14: 5.58, 15: 8.15, 16: 12.05, 17: 16.826, 18: 21.16, 20: 27.0 },
  2: { 5: 1.04, 6: 2.0, 7: 1.75, 8: 2.55, 9: 3.15, 10: 3.85, 11: 4.25, 12: 4.45, 13: 4.32, 14: 5.28, 15: 7.55, 16: 11.8, 17: 16.356, 18: 20.608, 20: 26.1 },
  3: { 8: 0.62, 9: 0.96, 10: 1.35, 11: 1.9, 12: 2.62, 13: 3.45, 14: 4.38, 15: 6.12, 16: 8.85, 17: 13.35, 18: 16.75, 20: 20.85 },
  4: { 12: 0.12, 13: 1.08, 14: 2.65, 15: 4.1, 16: 6.45, 17: 10.85, 18: 13.75, 20: 17.8 },
});

/**
 * Calibrated Two-Regime Traffic Width Curves (`[zoom, [tier1, tier2, tier3, tier4]]`):
 * - Overview Regime (z5..z13): Bold Google-style (`GR-01..GR-05`) corridor prominence so the traffic situation
 *   across the country, region, and city is immediately readable at a glance.
 * - Street-Detail Regime (z14..z20): Slim directional bands contained strictly inside Borbalo's road pavement,
 *   matching Google (GM-01..GM-08) and Yandex (YX-M04..YX-M07) street-level proportions.
 */
export const TRAFFIC_CORE_WIDTH_STOPS = Object.freeze([
  [5, [1.50, 1.30, 1.10, 0.95]],
  [7, [1.80, 1.55, 1.30, 1.10]],
  [9, [2.10, 1.80, 1.50, 1.20]],
  [11, [2.40, 2.05, 1.75, 1.40]],
  [13, [2.60, 2.25, 1.90, 1.50]],
  [14, [2.55, 2.25, 1.85, 1.20]],
  [15, [3.15, 2.75, 2.20, 1.50]],
  [16, [3.95, 3.45, 2.80, 2.05]],
  [17, [4.85, 4.25, 3.45, 2.65]],
  [18, [5.80, 5.05, 4.10, 3.15]],
  [20, [6.95, 5.95, 4.90, 3.80]],
]);

/**
 * Casing extra total width (`2 * border_thickness`) added to `TRAFFIC_CORE_WIDTH_STOPS` at each zoom stop.
 */
export const TRAFFIC_CASING_EXTRA_STOPS = Object.freeze({
  5: 0.90,
  7: 1.00,
  9: 1.10,
  11: 1.20,
  13: 1.25,
  14: 1.20,
  15: 1.30,
  16: 1.45,
  17: 1.60,
  18: 1.75,
  20: 1.95,
});

/**
 * Calibrated Right-Hand Directional Offset Stops (`[zoom, [tier1, tier2, tier3, tier4]]`):
 * - At overview scales (z5..z13), $2 d(z) - w_{\text{core}}(z) \ge 0.80\text{..}1.50\text{ px}$ separates opposing directions
 *   with a crisp dark median divider so both directions and their right-hand travel side are unmistakable at a glance.
 * - At street scales (z14..z20), $2 d(z) > w_{\text{core}}(z)$ creates a clean centre divider gap on two-way roads
 *   while keeping $d(z) + w_{\text{core}}(z)/2 < W_{\text{pavement}}(z)/2$, and one-way carriageways taper to `0px` offset.
 */
export const TRAFFIC_OFFSET_STOPS = Object.freeze([
  [5, [1.15, 1.00, 0.85, 0.72]],
  [7, [1.40, 1.22, 1.02, 0.85]],
  [9, [1.65, 1.45, 1.20, 0.95]],
  [11, [1.90, 1.65, 1.40, 1.10]],
  [13, [2.05, 1.80, 1.52, 1.20]],
  [14, [1.20, 1.40, 1.15, 0.68]],
  [15, [1.60, 1.85, 1.50, 1.00]],
  [16, [2.05, 2.55, 2.05, 1.45]],
  [17, [2.50, 3.40, 2.75, 2.05]],
  [18, [3.00, 4.20, 3.40, 2.55]],
  [20, [3.60, 5.15, 4.15, 3.15]],
]);

/**
 * 7 Z-Level Deck definitions matching Borbalo's `prod-browse-*` and `prod-drive-*` layer stack (`z = -1..5`).
 */
export const TRAFFIC_Z_LEVEL_DECKS = Object.freeze([
  {
    grade: -1,
    casingId: 'traffic-flow-z-1-casing',
    flowId: 'traffic-flow-z-1',
    label: 'Tunnel Deck (z = -1)',
    beforeCandidates: [
      'tunnel_major_rail',
      'road_area_pattern',
      'road_motorway_link_casing',
      'road_motorway_casing',
    ],
  },
  {
    grade: 0,
    casingId: 'traffic-flow-casing',
    flowId: 'traffic-flow',
    label: 'Ground Road Deck (z = 0)',
    beforeCandidates: [
      'road_major_rail',
      'road_label_major_ground',
      'bridge_path_pedestrian_shadow_l1',
      'bridge_motorway_link_shadow_l1',
      'bridge_motorway_deck',
    ],
  },
  {
    grade: 1,
    casingId: 'traffic-flow-z1-casing',
    flowId: 'traffic-flow-z1',
    label: 'Bridge Deck L1 (z = 1)',
    beforeCandidates: [
      'bridge_major_rail_l1',
      'bridge_path_pedestrian_shadow_l2',
      'bridge_motorway_link_shadow_l2',
    ],
  },
  {
    grade: 2,
    casingId: 'traffic-flow-z2-casing',
    flowId: 'traffic-flow-z2',
    label: 'Bridge Deck L2 (z = 2)',
    beforeCandidates: [
      'bridge_major_rail_l2',
      'bridge_path_pedestrian_shadow_l3',
      'bridge_motorway_link_shadow_l3',
    ],
  },
  {
    grade: 3,
    casingId: 'traffic-flow-z3-casing',
    flowId: 'traffic-flow-z3',
    label: 'Bridge Deck L3 (z = 3)',
    beforeCandidates: [
      'bridge_major_rail_l3',
      'bridge_path_pedestrian_shadow_l4',
      'bridge_motorway_link_shadow_l4',
    ],
  },
  {
    grade: 4,
    casingId: 'traffic-flow-z4-casing',
    flowId: 'traffic-flow-z4',
    label: 'Bridge Deck L4 (z = 4)',
    beforeCandidates: [
      'bridge_major_rail_l4',
      'bridge_path_pedestrian_shadow_l5',
      'bridge_motorway_link_shadow_l5',
    ],
  },
  {
    grade: 5,
    casingId: 'traffic-flow-z5-casing',
    flowId: 'traffic-flow-z5',
    label: 'Bridge Deck L5 (z = 5)',
    beforeCandidates: [
      'bridge_major_rail_l5',
      'route_alt_casing',
      'closed_road_major_halo',
      'route_main_casing',
      'road_label_major_ground_halo',
      'building-3d',
      'road_shield_geo',
    ],
  },
]);

const r2 = value => Math.round(value * 100) / 100;

/**
 * Dual-schema road tier expression (`1` = Motorway/Backbone, `2` = Trunk/Primary, `3` = Secondary/Tertiary/Arterial, `4` = Minor/Local).
 */
export function buildRoadTierExpression() {
  const clsExpr = ['coalesce', ['get', 'traffic_display_class'], ['get', 'class'], ['get', 'road_class'], ''];
  return [
    'case',
    ['in', clsExpr, ['literal', ['motorway', 'motorway_detail']]],
    1,
    ['==', ['get', 'rank'], 1],
    1,
    ['in', clsExpr, ['literal', ['trunk', 'primary', 'motorway_link', 'trunk_link']]],
    2,
    ['==', ['get', 'rank'], 2],
    2,
    ['in', clsExpr, ['literal', ['secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link']]],
    3,
    ['any', ['==', ['get', 'rank'], 3], ['==', ['get', 'arterial'], 1]],
    3,
    4,
  ];
}

/**
 * Computes the integer Z-level deck (`-1` for tunnels, `0` for ground roads, `1..5` for bridge decks `l1..l5`).
 */
export function buildElevationExpression() {
  return [
    'case',
    ['==', ['get', 'brunnel'], 'tunnel'],
    -1,
    ['==', ['get', 'brunnel'], 'bridge'],
    ['max', 1, ['min', 5, ['to-number', ['coalesce', ['get', 'layer'], ['get', 'level'], 1], 1]]],
    ['has', 'layer'],
    ['max', -1, ['min', 5, ['to-number', ['get', 'layer'], 0]]],
    ['has', 'level'],
    ['max', -1, ['min', 5, ['to-number', ['get', 'level'], 0]]],
    0,
  ];
}

/**
 * Builds the MapLibre `filter` expression with a hard `["step", ["zoom"], ...]` hierarchy cutoff
 * so smaller streets disappear DIRECTLY (instantly, with zero fade-out) when zooming out,
 * and low-zoom overview bands (`zoom_band: 6, 8, 10, 12`) switch cleanly to merged corridors.
 */
export function buildTrafficFilter({
  navigationMode = 'browse',
  grade = 'all',
} = {}) {
  const profile = NAVIGATION_MODE_PROFILES[navigationMode] || NAVIGATION_MODE_PROFILES.browse;
  const baseConditions = [
    ['!=', ['get', 'closed'], 1],
    ['!=', ['get', 'closed'], true],
    ['!=', ['get', 'closure'], true],
    ['any', ['has', 'cong'], ['has', 'congestion'], ['has', 'traffic']],
  ];

  if (profile.excludeOnRoute) {
    baseConditions.push(['!=', ['get', 'on_route'], true]);
    baseConditions.push(['!=', ['get', 'on_route'], 1]);
  }

  const elevationExpr = buildElevationExpression();
  if (typeof grade === 'number') {
    baseConditions.push(['==', elevationExpr, grade]);
  } else if (grade === 'tunnel') {
    baseConditions.push(['==', elevationExpr, -1]);
  } else if (grade === 'ground') {
    baseConditions.push(['==', elevationExpr, 0]);
  } else if (grade === 'bridge') {
    baseConditions.push(['>=', elevationExpr, 1]);
  }

  const clsExpr = ['coalesce', ['get', 'traffic_display_class'], ['get', 'class'], ['get', 'road_class'], ''];
  const tierExpr = buildRoadTierExpression();
  const unbanded = ['!', ['has', 'zoom_band']];
  const corridorSelected = ['==', ['get', 'traffic_corridor_selected'], true];
  const unchosen = ['!', ['has', 'traffic_corridor_selected']];

  // Hard step(zoom) branch builders — instant direct appearance/disappearance, zero opacity fading:
  // z5..7.99: Band 6 merged national/international corridors (E60, E117, ს-roads, motorway, trunk)
  const filterZ5 = [
    'all',
    ...baseConditions,
    [
      'any',
      ['==', ['get', 'zoom_band'], 6],
      ['all', unbanded, corridorSelected],
      [
        'all',
        unbanded,
        unchosen,
        [
          'any',
          ['in', clsExpr, ['literal', ['motorway', 'motorway_detail', 'trunk', 'motorway_link', 'trunk_link']]],
          ['<=', ['to-number', ['get', 'rank'], 99], 2],
        ],
      ],
    ],
  ];

  // z8..9.99: Band 8 merged intercity/regional corridors (adds primary & regional შ-roads like Tsqneti Hwy -> Chavchavadze Ave)
  const filterZ8 = [
    'all',
    ...baseConditions,
    [
      'any',
      ['==', ['get', 'zoom_band'], 8],
      ['all', unbanded, corridorSelected],
      ['all', unbanded, unchosen, ['<=', tierExpr, 2]],
    ],
  ];

  // z10..11.49: Band 10 merged metropolitan arterial corridors (keeps primary & regional through-corridors; secondary district streets wait until z11.5)
  const filterZ10 = [
    'all',
    ...baseConditions,
    [
      'any',
      ['==', ['get', 'zoom_band'], 10],
      ['all', unbanded, corridorSelected],
      [
        'all',
        unbanded,
        unchosen,
        [
          'any',
          ['<=', tierExpr, 2],
          ['in', clsExpr, ['literal', ['motorway_link', 'trunk_link', 'primary_link']]],
        ],
      ],
    ],
  ];

  // z11.5..13.99: Band 12 merged secondary & link corridors (adds secondary district collectors; tertiary/lake roads stay hidden until z14!)
  const filterZ11_5 = [
    'all',
    ...baseConditions,
    [
      'any',
      ['==', ['get', 'zoom_band'], 12],
      ['all', unbanded, corridorSelected],
      [
        'all',
        unbanded,
        unchosen,
        [
          'any',
          ['<=', tierExpr, 2],
          ['in', clsExpr, ['literal', ['secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']]],
        ],
      ],
    ],
  ];

  // z14..14.49: Band 14 exact road-matched geometry for Tiers 1..3 (adds tertiary; minor streets disappear directly below z14.5!)
  const filterZ14 = [
    'all',
    ...baseConditions,
    ['any', ['==', ['get', 'zoom_band'], 14], unbanded],
    ['any', corridorSelected, ['<=', tierExpr, 3]],
  ];

  // z14.5..15.99: Band 14 exact road-matched geometry for Tiers 1..4 excluding service roads
  const filterZ14_5 = [
    'all',
    ...baseConditions,
    ['any', ['==', ['get', 'zoom_band'], 14], unbanded],
    ['!=', clsExpr, 'service'],
    ['!=', clsExpr, 'service_link'],
  ];

  // z16+: Band 14 exact road-matched geometry for all roads including service
  const filterZ16 = [
    'all',
    ...baseConditions,
    ['any', ['==', ['get', 'zoom_band'], 14], unbanded],
  ];

  return [
    'step',
    ['zoom'],
    filterZ5,
    8, filterZ8,
    10, filterZ10,
    11.5, filterZ11_5,
    14, filterZ14,
    14.5, filterZ14_5,
    16, filterZ16,
  ];
}

/**
 * Builds the 100% solid (`#RRGGBB`) `line-color` expression supporting both raw production MVT (`cong`: 3,2,1,0 + `speed`)
 * and enriched string properties (`congestion` / `traffic`: "free", "low", "moderate", "heavy", "severe", "jam", "standstill").
 */
export function buildTrafficColorExpression({
  theme = 'day',
  palette = 'borbalo',
  navigationMode = 'browse',
  isCasing = false,
  grade = 0,
} = {}) {
  const pal = TRAFFIC_PALETTES[palette] || TRAFFIC_PALETTES.borbalo;
  const themeColors = pal[theme === 'night' ? 'night' : 'day'];
  const isTunnel = grade === -1 || grade === 'tunnel';
  const modeKey = isTunnel ? 'tunnel' : (themeColors.modes[navigationMode] ? navigationMode : 'browse');
  const activeSet = themeColors.modes?.[modeKey] || themeColors;
  const colors = isCasing ? activeSet.casing : activeSet;

  const statusExpr = ['coalesce', ['get', 'congestion'], ['get', 'traffic'], ''];

  return [
    'case',
    ['==', statusExpr, 'standstill'],
    colors.standstill,
    ['in', statusExpr, ['literal', ['severe', 'jam']]],
    [
      'case',
      ['all', ['has', 'speed'], ['<=', ['to-number', ['get', 'speed'], 99], 5]],
      colors.standstill,
      colors.severe,
    ],
    ['==', statusExpr, 'heavy'],
    colors.heavy,
    ['==', statusExpr, 'moderate'],
    colors.moderate,
    ['in', statusExpr, ['literal', ['free', 'low']]],
    colors.free,
    // Numeric MVT `cong` contract (`0` = severe, `1` = heavy, `2` = moderate, `3` = free)
    ['==', ['get', 'cong'], 0],
    [
      'case',
      ['all', ['has', 'speed'], ['<=', ['to-number', ['get', 'speed'], 99], 5]],
      colors.standstill,
      colors.severe,
    ],
    ['==', ['get', 'cong'], 1],
    colors.heavy,
    ['==', ['get', 'cong'], 2],
    colors.moderate,
    ['==', ['get', 'cong'], 3],
    colors.free,
    colors.free,
  ];
}

/**
 * Builds the two-regime `line-width` expression across zooms 5..20.
 */
export function buildTrafficWidthExpression({
  navigationMode = 'browse',
  isCasing = false,
} = {}) {
  const profile = NAVIGATION_MODE_PROFILES[navigationMode] || NAVIGATION_MODE_PROFILES.browse;
  const scale = profile.widthScale ?? 1.0;
  const tierExpr = buildRoadTierExpression();

  const expr = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, [t1, t2, t3, t4]] of TRAFFIC_CORE_WIDTH_STOPS) {
    const extra = isCasing ? (TRAFFIC_CASING_EXTRA_STOPS[zoom] ?? 1.2) : 0;
    const w1 = r2(t1 * scale + extra);
    const w2 = r2(t2 * scale + extra);
    const w3 = r2(t3 * scale + extra);
    const w4 = r2(t4 * scale + extra);
    expr.push(
      zoom,
      [
        'match',
        tierExpr,
        1, w1,
        2, w2,
        3, w3,
        w4,
      ],
    );
  }
  return expr;
}

/**
 * Builds the right-hand directional `line-offset` expression across zooms 5..20.
 * - On two-way shared-centreline roads (`traffic_layout == "shared"` or `oneway == 0`), offsets each travel direction
 *   into its right-hand lane (`±d(z)`).
 * - On separately digitised one-way carriageways/ramps (`oneway == 1` or `traffic_road_oneway == true` or `traffic_layout == "separate"`),
 *   applies a gentle overview separation at `z5..z12` and tapers to `0px` at `z >= 14` so zoomed-in one-way roads and ramps
 *   sit dead-centre on their rendered basemap pavement!
 */
export function buildTrafficOffsetExpression({
  navigationMode = 'browse',
} = {}) {
  const profile = NAVIGATION_MODE_PROFILES[navigationMode] || NAVIGATION_MODE_PROFILES.browse;
  const scale = profile.offsetScale ?? 1.0;
  const tierExpr = buildRoadTierExpression();

  const isOneWaySeparate = [
    'any',
    ['==', ['get', 'traffic_road_oneway'], true],
    ['==', ['get', 'oneway'], 1],
    ['==', ['get', 'oneway'], -1],
    ['==', ['get', 'traffic_layout'], 'separate'],
  ];

  const signExpr = [
    'case',
    ['has', 'offset_side'],
    ['to-number', ['get', 'offset_side'], 1],
    ['has', 'direction_sign'],
    ['to-number', ['get', 'direction_sign'], 1],
    ['==', ['get', 'traffic_layout'], 'single'],
    0,
    1,
  ];

  const expr = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, [d1, d2, d3, d4]] of TRAFFIC_OFFSET_STOPS) {
    // At street detail zooms (z >= 14), one-way carriageways already have distinct geometry, so offset is 0 (dead-centre).
    const oneWayFactor = zoom <= 11 ? 1.0 : zoom <= 13 ? 0.65 : 0.0;
    const modeFactorExpr = ['case', isOneWaySeparate, oneWayFactor, 1.0];

    expr.push(
      zoom,
      [
        '*',
        signExpr,
        modeFactorExpr,
        [
          'match',
          tierExpr,
          1, r2(d1 * scale),
          2, r2(d2 * scale),
          3, r2(d3 * scale),
          r2(d4 * scale),
        ],
      ],
    );
  }
  return expr;
}

/**
 * Returns constant `1` for `line-opacity` — zero transparent colours or zoom opacity fading.
 */
export function buildTrafficOpacityExpression() {
  return 1;
}

/**
 * Builds the `route_upcoming_traffic` paint & layout patch with `line-opacity: 1` (100% solid).
 */
export function buildRouteTrafficLayerPatch({
  theme = 'day',
  palette = 'borbalo',
} = {}) {
  const pal = TRAFFIC_PALETTES[palette] || TRAFFIC_PALETTES.borbalo;
  const t = pal[theme === 'night' ? 'night' : 'day'];

  return {
    id: 'route_upcoming_traffic',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': [
        'case',
        ['==', ['coalesce', ['get', 'traffic'], ['get', 'congestion'], ''], 'standstill'],
        t.standstill,
        ['in', ['coalesce', ['get', 'traffic'], ['get', 'congestion'], ''], ['literal', ['jam', 'severe']]],
        t.severe,
        ['==', ['coalesce', ['get', 'traffic'], ['get', 'congestion'], ''], 'heavy'],
        t.heavy,
        ['==', ['coalesce', ['get', 'traffic'], ['get', 'congestion'], ''], 'moderate'],
        t.moderate,
        ['in', ['coalesce', ['get', 'traffic'], ['get', 'congestion'], ''], ['literal', ['free', 'low']]],
        t.routeFree,
        ['==', ['get', 'cong'], 0],
        t.severe,
        ['==', ['get', 'cong'], 1],
        t.heavy,
        ['==', ['get', 'cong'], 2],
        t.moderate,
        ['==', ['get', 'cong'], 3],
        t.routeFree,
        t.severe,
      ],
      'line-opacity': 1,
      'line-width': [
        'interpolate',
        ['exponential', 1.2],
        ['zoom'],
        10, 3.8,
        12, 5.8,
        14, 8.2,
        16, 11.8,
        17, 15.4,
        18, 19.4,
        20, 25.2,
      ],
    },
  };
}

/**
 * Generates the complete Borbalo Traffic Add-On manifest (`source`, `layers`, `beforeId`, `routePatch`, `metadata`).
 *
 * By default (`gradeSeparated: true`), emits all 7 Z-level deck pairs (`z = -1, 0, 1, 2, 3, 4, 5`)
 * interleaved directly with Borbalo's `tunnel_*`, `road_*`, and `bridge_*_l1..l5` decks.
 * When `gradeSeparated: false`, emits the single-deck 2-layer pair (`traffic-flow-casing`, `traffic-flow`).
 */
export function createTrafficAddon({
  mode = 'browse',
  navigationState = null,
  theme = 'day',
  palette = 'borbalo',
  sourceId = 'traffic',
  sourceLayer = 'traffic',
  tileJsonUrl = DEFAULT_TRAFFIC_TILEJSON_URL,
  visibility = 'none',
  gradeSeparated = true,
} = {}) {
  const effectiveNavMode = navigationState
    ? (navigationState === 'guidance' ? 'drive-guidance' : navigationState === 'preview' ? 'drive' : mode)
    : (mode === 'drive' ? 'drive' : 'browse');

  const commonLayout = {
    'line-cap': 'round',
    'line-join': 'round',
    visibility: visibility === 'visible' || visibility === true ? 'visible' : 'none',
  };

  const topRoadInsertionCandidates = [
    'route_alt_casing',
    'closed_road_major_halo',
    'route_main_casing',
    'route_upcoming_casing',
    'crossing-line-under',
    'road_label_major_ground_halo',
    'building-3d',
    'road_shield_geo',
  ];

  const makePair = (casingId, flowId, grade, beforeIdCandidates) => [
    {
      id: casingId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      minzoom: 5,
      filter: buildTrafficFilter({ navigationMode: effectiveNavMode, grade }),
      layout: { ...commonLayout },
      paint: {
        'line-color': buildTrafficColorExpression({
          theme,
          palette,
          navigationMode: effectiveNavMode,
          isCasing: true,
          grade,
        }),
        'line-width': buildTrafficWidthExpression({ navigationMode: effectiveNavMode, isCasing: true }),
        'line-offset': buildTrafficOffsetExpression({ navigationMode: effectiveNavMode }),
        'line-opacity': 1,
      },
      metadata: {
        'borbalo:addon': 'traffic',
        'borbalo:role': 'casing',
        'borbalo:grade': grade,
        'borbalo:beforeCandidates': beforeIdCandidates,
      },
    },
    {
      id: flowId,
      type: 'line',
      source: sourceId,
      'source-layer': sourceLayer,
      minzoom: 5,
      filter: buildTrafficFilter({ navigationMode: effectiveNavMode, grade }),
      layout: { ...commonLayout },
      paint: {
        'line-color': buildTrafficColorExpression({
          theme,
          palette,
          navigationMode: effectiveNavMode,
          isCasing: false,
          grade,
        }),
        'line-width': buildTrafficWidthExpression({ navigationMode: effectiveNavMode, isCasing: false }),
        'line-offset': buildTrafficOffsetExpression({ navigationMode: effectiveNavMode }),
        'line-opacity': 1,
      },
      metadata: {
        'borbalo:addon': 'traffic',
        'borbalo:role': 'flow',
        'borbalo:grade': grade,
        'borbalo:beforeCandidates': beforeIdCandidates,
      },
    },
  ];

  const layers = gradeSeparated
    ? TRAFFIC_Z_LEVEL_DECKS.flatMap(deck =>
        makePair(deck.casingId, deck.flowId, deck.grade, [
          ...deck.beforeCandidates,
          ...topRoadInsertionCandidates,
        ]),
      )
    : makePair('traffic-flow-casing', 'traffic-flow', 'all', topRoadInsertionCandidates);

  return {
    name: `borbalo-traffic-addon-${effectiveNavMode}-${theme}-${palette}`,
    version: '2.1.0',
    metadata: {
      'borbalo:traffic-addon-version': '2.1.0',
      'borbalo:traffic-mode': effectiveNavMode,
      'borbalo:traffic-theme': theme,
      'borbalo:traffic-palette': palette,
      'borbalo:traffic-grade-separated': Boolean(gradeSeparated),
      'borbalo:traffic-solid-colors': true,
      'borbalo:traffic-step-zoom-filter': true,
      'borbalo:traffic-reference-anchors': [
        'MASTER-TRAFFIC-RECREATION.html#navigation-modes',
        'GM-01..GM-08',
        'GR-01..GR-05',
        'YX-M01..YX-M07',
      ],
    },
    sources: {
      [sourceId]: {
        type: 'vector',
        url: tileJsonUrl,
      },
    },
    insertionOrder: {
      defaultBeforeCandidates: topRoadInsertionCandidates,
      zLevelDecks: TRAFFIC_Z_LEVEL_DECKS,
      rule: 'Interleave each traffic z-level deck (z=-1 tunnel, z=0 ground, z=1..5 bridge_l1..l5) immediately above its corresponding road deck and strictly below higher bridge decks, route overlays, road closures, and road labels.',
    },
    layers,
    routeLayerPatches: [
      buildRouteTrafficLayerPatch({ theme, palette }),
    ],
  };
}

/**
 * Resolves the first existing layer ID from `candidates` inside a style's `layers` array.
 */
export function resolveBeforeLayerId(layers, candidates = []) {
  const existing = new Set(layers.map(layer => layer.id));
  for (const id of candidates) {
    if (existing.has(id)) return id;
  }
  return undefined;
}

/**
 * Pure function that injects the Borbalo Traffic Add-On into a cloned MapLibre style JSON object.
 * Interleaves traffic layers across all 7 z-level decks (`z = -1..5`) by default.
 */
export function injectTrafficAddonIntoStyle(styleJson, options = {}) {
  const style = structuredClone(styleJson);
  const inferredMode = options.mode
    || style.metadata?.['borbalo:mode']
    || (JSON.stringify(style.metadata || {}).toLowerCase().includes('drive') ? 'drive' : 'browse');
  const inferredTheme = options.theme
    || (style.layers?.some(l => l.id === 'background' && String(l.paint?.['background-color']).match(/#(0|1|2)/i))
      ? 'night'
      : 'day');

  const addon = createTrafficAddon({
    ...options,
    mode: inferredMode,
    theme: inferredTheme,
  });

  style.sources = style.sources || {};
  for (const [sourceId, sourceDef] of Object.entries(addon.sources)) {
    if (!style.sources[sourceId] || options.overwriteSource) {
      style.sources[sourceId] = structuredClone(sourceDef);
    }
  }

  style.metadata = {
    ...(style.metadata || {}),
    ...addon.metadata,
  };

  const addonLayerIds = new Set([
    'traffic-flow-casing',
    'traffic-flow',
    'traffic-flow-tunnel-casing',
    'traffic-flow-tunnel',
    'traffic-flow-bridge-casing',
    'traffic-flow-bridge',
    ...TRAFFIC_Z_LEVEL_DECKS.flatMap(d => [d.casingId, d.flowId]),
    ...addon.layers.map(l => l.id),
  ]);

  // Remove any previously injected or misplaced traffic flow layers
  style.layers = (style.layers || []).filter(layer => !addonLayerIds.has(layer.id));

  // Apply route traffic patch (`route_upcoming_traffic`) if present in style
  if (options.patchRouteTraffic !== false) {
    for (const patch of addon.routeLayerPatches) {
      const target = style.layers.find(layer => layer.id === patch.id);
      if (target) {
        target.layout = { ...(target.layout || {}), ...patch.layout };
        target.paint = { ...(target.paint || {}), ...patch.paint };
      }
    }
  }

  // Insert each add-on layer before its resolved z-level deck anchor
  for (const rawLayer of addon.layers) {
    const layer = structuredClone(rawLayer);
    const candidates = layer.metadata?.['borbalo:beforeCandidates'] || addon.insertionOrder.defaultBeforeCandidates;
    delete layer.metadata;
    const beforeId = resolveBeforeLayerId(style.layers, candidates);
    if (beforeId) {
      const index = style.layers.findIndex(item => item.id === beforeId);
      style.layers.splice(index, 0, layer);
    } else {
      style.layers.push(layer);
    }
  }

  return style;
}

/**
 * Mounts or updates the Borbalo Traffic Add-On on a live MapLibre GL JS `map` instance.
 */
export function mountTrafficAddon(map, options = {}) {
  let state = {
    mode: options.mode || 'browse',
    navigationState: options.navigationState || null,
    theme: options.theme || 'day',
    palette: options.palette || 'borbalo',
    sourceId: options.sourceId || 'traffic',
    sourceLayer: options.sourceLayer || 'traffic',
    tileJsonUrl: options.tileJsonUrl || DEFAULT_TRAFFIC_TILEJSON_URL,
    sourceData: options.sourceData || null,
    visibility: options.visibility ?? 'visible',
    gradeSeparated: options.gradeSeparated ?? true,
  };

  function apply() {
    const addon = createTrafficAddon(state);
    const styleLayers = map.getStyle()?.layers || [];

    if (!map.getSource(state.sourceId)) {
      if (state.sourceData) {
        map.addSource(state.sourceId, {
          type: 'geojson',
          data: state.sourceData,
        });
      } else {
        map.addSource(state.sourceId, addon.sources[state.sourceId]);
      }
    }

    const isGeoJsonSource = Boolean(state.sourceData) || map.getSource(state.sourceId)?.type === 'geojson';

    for (const rawLayer of addon.layers) {
      const layer = structuredClone(rawLayer);
      const candidates = layer.metadata?.['borbalo:beforeCandidates'] || addon.insertionOrder.defaultBeforeCandidates;
      delete layer.metadata;
      if (isGeoJsonSource) {
        delete layer['source-layer'];
      }

      if (map.getLayer(layer.id)) {
        map.setFilter(layer.id, layer.filter);
        map.setLayoutProperty(layer.id, 'visibility', layer.layout.visibility);
        map.setLayoutProperty(layer.id, 'line-cap', layer.layout['line-cap']);
        map.setLayoutProperty(layer.id, 'line-join', layer.layout['line-join']);
        for (const [k, v] of Object.entries(layer.paint)) {
          map.setPaintProperty(layer.id, k, v);
        }
      } else {
        const beforeId = resolveBeforeLayerId(styleLayers, candidates);
        map.addLayer(layer, beforeId);
      }
    }

    for (const patch of addon.routeLayerPatches) {
      if (map.getLayer(patch.id)) {
        for (const [k, v] of Object.entries(patch.layout || {})) {
          map.setLayoutProperty(patch.id, k, v);
        }
        for (const [k, v] of Object.entries(patch.paint || {})) {
          map.setPaintProperty(patch.id, k, v);
        }
      }
    }

    return addon;
  }

  apply();

  return {
    getState: () => ({ ...state }),
    update(patch = {}) {
      state = { ...state, ...patch };
      return apply();
    },
    setVisibility(visible) {
      state.visibility = visible === true || visible === 'visible' ? 'visible' : 'none';
      return apply();
    },
    setNavigationMode(mode, navigationState = null) {
      state.mode = mode;
      state.navigationState = navigationState;
      return apply();
    },
    setPalette(palette) {
      state.palette = palette;
      return apply();
    },
    setTheme(theme) {
      state.theme = theme;
      return apply();
    },
  };
}
