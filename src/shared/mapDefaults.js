// Valores por defecto y rangos «realistas» del mapa, en metros. Los usan el validador (avisos de medidas raras), el editor (valores iniciales,
// colores) y, más adelante, los generadores de relleno. Sirven de guía, no de regla estricta: salirse del rango da un aviso, no un error.

export const AREA_KINDS = ['water', 'land', 'sand', 'field', 'forest', 'park', 'mountain', 'urban', 'plaza'];
export const WAY_KINDS = ['avenue', 'street', 'path', 'river', 'stream', 'wall', 'rail', 'bridge'];
export const FILL_PATTERNS = ['none', 'organic', 'grid', 'radial', 'forest'];

export const AREA_LABEL = { water: 'Agua', land: 'Tierra', sand: 'Arena', field: 'Campo', forest: 'Bosque', park: 'Parque', mountain: 'Montaña', urban: 'Zona urbana', plaza: 'Plaza' };
export const WAY_LABEL = { avenue: 'Avenida', street: 'Calle', path: 'Sendero', river: 'Río', stream: 'Arroyo', wall: 'Muralla', rail: 'Vía férrea', bridge: 'Puente' };
export const PATTERN_LABEL = { none: 'Sin relleno', organic: 'Orgánico', grid: 'Cuadrícula', radial: 'Radial', forest: 'Árboles' };

// Orden de dibujo por defecto (de abajo hacia arriba): el agua queda bajo la tierra firme, que queda bajo el bosque y la ciudad.
export const AREA_Z = { water: 0, land: 1, sand: 2, mountain: 3, field: 4, forest: 5, park: 6, urban: 7, plaza: 8 };
export const WAY_Z = { river: 10, stream: 10, rail: 11, path: 12, street: 13, avenue: 14, wall: 15, bridge: 16 };

// Colores base (el tema/estilo final se aplica al exportar; esto es lo que ve el autor mientras dibuja).
export const AREA_COLOR = { water: '#5da9d6', land: '#d9d3b0', sand: '#e6d7a4', field: '#d9d27a', forest: '#5f9a55', park: '#8ec97a', mountain: '#a79d92', urban: '#cdbfae', plaza: '#e8dcc0' };
export const WAY_COLOR = { avenue: '#f4ead2', street: '#fff6e0', path: '#c9a874', river: '#4f96c8', stream: '#6aaedb', wall: '#6d6558', rail: '#7b7b86', bridge: '#d7c9a8' };

// Anchura típica de cada línea y rango razonable (m). Una calle de barrio ronda los 8–12 m entre fachadas; una avenida, 16–30 m.
export const WAY_WIDTH = { avenue: 20, street: 10, path: 3, river: 60, stream: 6, wall: 4, rail: 6, bridge: 10 };
export const WAY_WIDTH_RANGE = { avenue: [12, 40], street: [6, 16], path: [1.5, 6], river: [15, 400], stream: [2, 15], wall: [2, 8], rail: [4, 10], bridge: [4, 40] };

// Relleno por defecto de una zona urbana ORGÁNICA (la que más se usará): manzanas de 60–140 m, parcelas de casa de ~10×14 m.
export const FILL_DEFAULTS = {
  organic: { pattern: 'organic', seed: 1, blockSize: { min: 60, max: 140 }, lotSize: { width: 12, depth: 16 }, density: 0.75, streetWidth: 9, rotation: 0 },
  grid: { pattern: 'grid', seed: 1, blockSize: { min: 70, max: 110 }, lotSize: { width: 12, depth: 18 }, density: 0.85, streetWidth: 10, rotation: 0 },
  radial: { pattern: 'radial', seed: 1, blockSize: { min: 60, max: 120 }, lotSize: { width: 12, depth: 16 }, density: 0.8, streetWidth: 10, rotation: 0, center: [0, 0], rings: 4, spokes: 12 },
  forest: { pattern: 'forest', seed: 1, treeSpacing: 4.5, density: 0.9 },   // copas de 2–4 m que se solapan: bosque tupido
  none: { pattern: 'none' }
};
// Rangos que disparan un aviso (no un error).
export const FILL_RANGE = { blockSize: [25, 400], lotWidth: [4, 60], lotDepth: [5, 80], streetWidth: [3, 40], treeSpacing: [2, 30] };

// Tamaños típicos de referencia (m), para tener a mano al dibujar y para los asistentes de ciudad.
export const TYPICAL = {
  house: [8, 15], rowHouseWidth: [5, 7], apartmentBlock: [20, 40], block: [60, 140], district: [500, 2000], cityDiameter: [3000, 8000], plaza: [60, 120], wallThickness: [3, 6]
};

// Límites de tamaño del archivo del mapa (protegen al editor y al servidor de entradas absurdas).
export const MAP_LIMITS = { areas: 2000, ways: 4000, places: 2000, districts: 200, links: 200, groups: 500, underlays: 12, vertices: 2000, coordinate: 1_000_000 };
