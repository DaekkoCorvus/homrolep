# Heroes of Misery RPG

Prototipo mobile-first de un simulador social y RPG narrativo ambientado en el universo de Heroes of Misery. Esta primera versión ofrece un pequeño mundo funcional; no pretende implementar todavía el lore, combate ni dirección narrativa con IA completos.

## Estado

**Prototype / MVP.** Incluye creación y persistencia de Runs, reloj de mundo, navegación por Northfortress, acciones libres con respuesta mock, Event Log semántico, feed social y un shell PWA adaptable a teléfonos.

## Requisitos

- Node.js 20 o posterior
- npm

No usa dependencias de producción ni módulos nativos.

## Instalación

```bash
git clone <REPOSITORY_URL>
cd heroes-of-misery-rpg
npm install
npm start
```

Abre `http://localhost:3000`. El servidor escucha en `0.0.0.0`; puedes cambiar el puerto con la variable `PORT`.

Para desarrollo con recarga automática del servidor:

```bash
npm run dev
```

## Termux

```bash
pkg update
pkg install git nodejs
git clone <REPOSITORY_URL>
cd heroes-of-misery-rpg
npm install
npm start
```

Después, abre `http://localhost:3000` en el navegador Android.

## Pruebas

```bash
npm test
```

## Configuración y seguridad

Copia `.env.example` a `.env` cuando se incorporen proveedores externos. `.env` está ignorado por Git. Las futuras llamadas de IA deben pasar por el servidor: nunca incluyas `AI_API_KEY` ni otros secretos en `src/client`.

El proveedor actual es un mock local; el juego funciona sin IA.

## Arquitectura

```text
src/client/             interfaz web mobile-first
src/server/index.js     servidor HTTP y API local
src/server/game/        reglas deterministas y contratos futuros
src/server/saves/       persistencia JSON atómica
src/server/ai/          interfaz del proveedor de IA
data/canon/             datos base inmutables del universo
data/templates/         esquemas de contenido futuro
public/                 manifest y service worker
saves/                  estado de Runs (fuera de Git)
tests/                  pruebas de reglas de juego
```

`CANON` describe el estado base. Cada `RUN STATE` guarda únicamente los cambios de una partida. Una Run nunca modifica los archivos canon.

El código es autoridad para dinero, inventario, tiempo, estadísticas, acceso y persistencia. La IA futura se limitará a interpretación, diálogo, narrativa y eventos dinámicos.

## API local

- `GET /api/world` — mundo de prueba
- `GET /api/runs` — partidas guardadas
- `POST /api/runs` — crear partida
- `GET /api/runs/:id` — cargar partida
- `POST /api/runs/:id/action` — ejecutar acción
- `POST /api/runs/:id/posts` — publicar en el feed

## Filosofía futura del GM

El GM observará un resumen compacto del Run State, propondrá hooks y eventos causales, adaptará historias al rol del jugador e interpretará acciones sin alterar hechos duros. El jugador podrá ignorar un hook; el sistema no deberá forzarlo inmediatamente.

## Roadmap

- [ ] AI GM
- [ ] NPC routines
- [ ] Mission generation
- [ ] Social simulation avanzada
- [ ] Relationships
- [ ] Skills
- [ ] Equipment
- [ ] Combat
- [ ] Canon timeline
- [ ] User-created NPCs
