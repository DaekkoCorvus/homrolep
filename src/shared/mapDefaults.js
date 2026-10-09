// Valores por defecto y rangos «realistas» del mapa, en metros. Los usan el validador (avisos de medidas raras), el editor (valores iniciales,
// colores) y, más adelante, los generadores de relleno. Sirven de guía, no de regla estricta: salirse del rango da un aviso, no un error.

export const AREA_KINDS = ['water', 'land', 'sand', 'field', 'forest', 'park', 'mountain', 'urban', 'plaza', 'desert', 'arid', 'snow', 'industrial', 'region'];
export const WAY_KINDS = ['avenue', 'street', 'path', 'river', 'stream', 'wall', 'rail', 'bridge', 'border'];
export const FILL_PATTERNS = ['none', 'organic', 'grid', 'radial', 'forest'];

export const AREA_LABEL = { water: 'Agua', land: 'Tierra', sand: 'Arena', field: 'Campo', forest: 'Bosque', park: 'Parque', mountain: 'Montaña', urban: 'Zona urbana', plaza: 'Plaza', desert: 'Desierto', arid: 'Zona árida', snow: 'Nieve', industrial: 'Zona industrial', region: 'Región / territorio' };
export const WAY_LABEL = { avenue: 'Avenida', street: 'Calle', path: 'Sendero', river: 'Río', stream: 'Arroyo', wall: 'Muralla', rail: 'Vía férrea', bridge: 'Puente', border: 'Frontera' };
export const PATTERN_LABEL = { none: 'Sin relleno', organic: 'Orgánico', grid: 'Cuadrícula', radial: 'Radial', forest: 'Árboles' };

// Orden de dibujo por defecto (de abajo hacia arriba): el agua queda bajo la tierra firme, que queda bajo el bosque y la ciudad.
export const AREA_Z = { water: 0, land: 1, sand: 2, desert: 2, arid: 2, mountain: 3, snow: 3, field: 4, forest: 5, park: 6, urban: 7, industrial: 7, plaza: 8, region: 9 };
export const WAY_Z = { river: 10, stream: 10, rail: 11, path: 12, street: 13, avenue: 14, wall: 15, bridge: 16, border: 17 };

// Colores base (el tema/estilo final se aplica al exportar; esto es lo que ve el autor mientras dibuja).
export const AREA_COLOR = { water: '#5da9d6', land: '#d9d3b0', sand: '#e6d7a4', field: '#d9d27a', forest: '#5f9a55', park: '#8ec97a', mountain: '#a79d92', urban: '#cdbfae', plaza: '#e8dcc0', desert: '#e3c58a', arid: '#c9a073', snow: '#f1f5f9', industrial: '#8d7b6e', region: '#c9a45c' };
export const WAY_COLOR = { avenue: '#f4ead2', street: '#fff6e0', path: '#c9a874', river: '#4f96c8', stream: '#6aaedb', wall: '#6d6558', rail: '#7b7b86', bridge: '#d7c9a8', border: '#b0443a' };

// Anchura típica de cada línea y rango razonable (m). Una calle de barrio ronda los 8–12 m entre fachadas; una avenida, 16–30 m.
// Los ríos y las fronteras de un mapa regional se dibujan mucho más anchos que en uno de ciudad: el rango lo permite.
export const WAY_WIDTH = { avenue: 20, street: 10, path: 3, river: 60, stream: 6, wall: 4, rail: 6, bridge: 10, border: 30 };
export const WAY_WIDTH_RANGE = { avenue: [12, 40], street: [6, 16], path: [1.5, 6], river: [15, 3000], stream: [2, 400], wall: [2, 8], rail: [4, 10], bridge: [4, 40], border: [2, 600] };

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

// --- Lugares ------------------------------------------------------------------------------------------------------------------------------------
// Los tipos viejos (home…other) siguen siendo válidos; los nuevos sirven para mapas regionales (capital, ciudad, pueblo, estación, distrito, puerto, instalación).
export const PLACE_KINDS = ['home', 'food', 'shop', 'poi', 'transport', 'gateway', 'other', 'capital', 'city', 'town', 'station', 'district', 'port', 'facility'];
export const PLACE_KIND_LABEL = { home: 'Casa', food: 'Comida', shop: 'Tienda', poi: 'Punto de interés', transport: 'Transporte', gateway: 'Puerta / frontera', other: 'Otro', capital: 'Capital', city: 'Ciudad', town: 'Pueblo', station: 'Estación', district: 'Distrito', port: 'Puerto', facility: 'Instalación especial' };
export const PLACE_KIND_COLOR = { home: '#2f9e55', food: '#d98a2b', shop: '#2a7fc9', poi: '#f4f4f4', transport: '#8d54d6', gateway: '#d43d77', other: '#7d8699', capital: '#f2c14e', city: '#e9e2cf', town: '#c9b99a', station: '#4aa3ff', district: '#b08fd8', port: '#3fc1c9', facility: '#ff7a59' };
// Importancia visual (1–5): manda el tamaño del símbolo y desde qué zoom se ve la etiqueta.
export const PLACE_IMPORTANCE = { home: 2, food: 2, shop: 2, poi: 2, transport: 2, gateway: 2, other: 2, capital: 5, city: 4, town: 3, station: 3, district: 2, port: 3, facility: 2 };
// Símbolos dibujados en el mapa (el icono por defecto sale del tipo; los tipos viejos no dibujan símbolo).
export const PLACE_ICONS = ['skyline', 'city', 'town', 'industrial', 'sanctuary', 'fortress', 'port', 'station', 'facility', 'gate', 'pin'];
export const PLACE_ICON_LABEL = { skyline: 'Megaciudad (rascacielos)', city: 'Ciudad', town: 'Pueblo', industrial: 'Industrial / fábricas', sanctuary: 'Santuario / templo', fortress: 'Fortaleza / muralla', port: 'Puerto', station: 'Gran estación', facility: 'Instalación', gate: 'Puerta exterior', pin: 'Marcador' };
export const PLACE_DEFAULT_ICON = { capital: 'skyline', city: 'city', town: 'town', station: 'station', port: 'port', facility: 'facility', gateway: 'gate' };   // un distrito y un punto de interés se ven como marcador con etiqueta, sin símbolo
// Tamaño real aproximado de lo que representa el símbolo (m), por importancia: el mapa lo dibuja a esa escala hasta un tamaño mínimo y máximo en pantalla.
export const SYMBOL_METERS = [600, 1500, 4000, 9000, 20000];

// --- Decoración ---------------------------------------------------------------------------------------------------------------------------------
export const DECOR_KINDS = ['compass', 'ship', 'ruins', 'tower', 'crest', 'label'];
export const DECOR_LABEL = { compass: 'Rosa de los vientos', ship: 'Barco', ruins: 'Ruinas', tower: 'Torre / faro', crest: 'Escudo', label: 'Etiqueta de texto (mar, cordillera…)' };
export const DECOR_SIZE = { compass: 30000, ship: 9000, ruins: 5000, tower: 5000, crest: 16000, label: 7000 };

// Límites de tamaño del archivo del mapa (protegen al editor y al servidor de entradas absurdas).
export const MAP_LIMITS = { areas: 2000, ways: 4000, places: 2000, districts: 200, links: 600, groups: 500, underlays: 12, vertices: 2000, coordinate: 1_000_000, lines: 40, decor: 400, linkVertices: 300, placeData: 20 };
