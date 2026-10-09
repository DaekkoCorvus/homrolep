// Capas del mapa: una clasificación de TODO lo que hay en él (terreno, agua, regiones, ciudades, distritos, puntos de interés, carreteras, ferrocarril,
// Northline, puertos, fronteras, etiquetas y decoración) para poder ocultarlas o bloquearlas por separado en el editor. Funciones puras y compartidas:
// el editor y el pintor usan la misma regla. La visibilidad y el bloqueo son del EDITOR (no se guardan en el mapa); aquí solo se decide a qué capa pertenece cada cosa.
import { TRAVEL_MODES } from './mapTravel.js';

export const LAYERS = [
  { id: 'terrain', label: 'Terreno', hint: 'Suelo pintado (tierra, bosques, montañas, nieve, desierto…) y áreas de terreno.' },
  { id: 'water', label: 'Agua', hint: 'Mares, lagos, ríos y arroyos.' },
  { id: 'regions', label: 'Regiones / territorio', hint: 'Territorios políticos y de facción.' },
  { id: 'cities', label: 'Ciudades', hint: 'Capitales, ciudades, pueblos y zonas urbanas.' },
  { id: 'districts', label: 'Distritos', hint: 'Zonas de juego (niebla, lugares del jugador) y lugares de tipo distrito.' },
  { id: 'pois', label: 'Puntos de interés', hint: 'Lugares sueltos: instalaciones, tiendas, puertas exteriores…' },
  { id: 'roads', label: 'Carreteras', hint: 'Calles, carreteras, caminos y rutas comerciales.' },
  { id: 'railways', label: 'Ferrocarril', hint: 'Vías y enlaces de tren.' },
  { id: 'northline', label: 'Northline', hint: 'La red Northline y sus estaciones.' },
  { id: 'ports', label: 'Puertos y rutas marítimas', hint: 'Puertos, rutas marítimas y ferris.' },
  { id: 'borders', label: 'Fronteras', hint: 'Fronteras y murallas.' },
  { id: 'labels', label: 'Etiquetas', hint: 'Nombres de regiones, ciudades y lugares.' },
  { id: 'decor', label: 'Decoración', hint: 'Rosa de los vientos, barcos, escudos, ruinas…' }
];
export const LAYER_IDS = LAYERS.map((layer) => layer.id);
export const LAYER_LABEL = Object.fromEntries(LAYERS.map((layer) => [layer.id, layer.label]));

const WAY_LAYER = { river: 'water', stream: 'water', rail: 'railways', border: 'borders', wall: 'borders', avenue: 'roads', street: 'roads', path: 'roads', bridge: 'roads' };
const PLACE_LAYER = { capital: 'cities', city: 'cities', town: 'cities', district: 'districts', port: 'ports' };

// Capa de un elemento. `type`: 'area' | 'way' | 'district' | 'place' | 'link' | 'decor' | 'terrain:<material>'.
// `map` solo hace falta para decidir la capa de una estación (sigue a los enlaces que llegan a ella).
export function layerOf(type, item, map = null) {
  if (type === 'district') return 'districts';
  if (type === 'decor') return item.kind === 'label' ? 'labels' : 'decor';
  if (type === 'area') {
    if (item.kind === 'water') return 'water';
    if (item.kind === 'region') return 'regions';
    return item.kind === 'urban' || item.kind === 'plaza' || item.kind === 'industrial' ? 'cities' : 'terrain';
  }
  if (type === 'way') return WAY_LAYER[item.kind] ?? 'roads';
  if (type === 'link') return TRAVEL_MODES[item.mode]?.layer ?? 'roads';
  if (type === 'place') {
    if (item.kind === 'station') {
      const mine = (map?.links ?? []).filter((link) => link.from === item.id || link.to === item.id);
      return mine.length && mine.every((link) => ['rail', 'train'].includes(link.mode)) ? 'railways' : 'northline';
    }
    return PLACE_LAYER[item.kind] ?? 'pois';
  }
  if (type.startsWith('terrain:')) return type.slice(8) === 'water' ? 'water' : 'terrain';
  return 'terrain';
}

// ¿Está oculta o bloqueada la capa de un elemento? `layers` = { hidden: Set, locked: Set } (cualquier cosa con `has`).
export const isHidden = (layers, type, item, map) => Boolean(layers?.hidden?.has(layerOf(type, item, map)));
export const isLocked = (layers, type, item, map) => Boolean(layers?.locked?.has(layerOf(type, item, map)));
