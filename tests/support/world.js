// Mundo de pruebas: un mapa pequeño y fijo (en metros) para que los tiempos de viaje de los tests no dependan del mapa real, que el autor
// va cambiando en el editor. Desde `apartment`: cafe 20 min, park 15, store 10, station 25 (80 m/min).
import { createStaticGeography, buildWorld } from '../../src/server/game/geography.js';
import { normalizeMap } from '../../src/shared/mapSchema.js';

const place = (id, name, kind, x, y, extra = {}) => ({ id, name, kind, x, y, hours: null, tags: [], description: '', ...extra });

export const fixtureMap = {
  schemaVersion: 2, id: 'testland', name: 'Testland',
  districts: [{ id: 'central', name: 'Central', color: '#c9a45c', polygon: [[-3000, -3000], [3000, -3000], [3000, 3000], [-3000, 3000]], fog: 'known' }],
  places: [
    place('apartment', 'Apartamento', 'home', 0, 0, { description: 'Tu pequeño espacio personal y punto de partida.' }),
    place('cafe', "Luna's Coffee", 'food', 1600, 0, { hours: { open: 6, close: 22 }, description: 'Una cafetería pequeña y acogedora.' }),
    place('park', 'Parque', 'poi', 0, 1200),
    place('store', 'Tienda MiniMarket', 'shop', -800, 0, { hours: { open: 8, close: 21 } }),
    place('station', 'Estación', 'transport', 0, -2000)
  ]
};
export const fixtureConfig = { spawn: 'station', walkMetersPerMinute: 80, minTravelMinutes: 2, maxWalkMinutes: 180 };

export const worldData = buildWorld(normalizeMap(fixtureMap), fixtureConfig);
export const fixtureGeography = () => createStaticGeography(fixtureMap, fixtureConfig);
