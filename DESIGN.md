# Dirección visual — «Luz de ventana en una ciudad nocturna»

Este documento describe el sistema visual **de Heroes of Misery RPG** (sustituye al DESIGN.md anterior, que describía otra web). La fuente de verdad son las variables de [`src/client/base.css`](src/client/base.css); si cambias un color o una fuente, cámbialo ahí.

Prioridades: inmersión, claridad y personalidad de videojuego por encima de las tendencias de diseño web.

## Capas

El CSS se organiza en cuatro capas, cargadas en este orden (`index.html`):

| Archivo | Capa | Qué es | Lenguaje |
|---|---|---|---|
| `base.css` | Base | Tokens, fuentes, reglas comunes, avisos (toast) | — |
| `umbral.css` | **El Umbral** | Lo sobrenatural: portada, creación, llegada, Ajustes y Partidas | Tinta oscura sobre el vórtice pálido, serif en cursiva, ✧ como firma de la Entidad |
| `mundo.css` | **El Mundo** | Northfortress: escena, narración, acciones, novela visual, mapa | Escena a pantalla completa, luz que cambia con la hora, **un solo acento cálido** (`--lamp`), mapa nocturno |
| `objetos.css` | **Los Objetos** | Teléfono, NorthLife, chats, diario | El teléfono moderno y creíble (aquí sí cabe el azul de NorthLife) |
| `desarrollo.css` | Desarrollo | Herramientas `/dev` | Verde `--dev`; no se ve en una partida normal |

El editor de mapas (`mapeditor.css`) es una herramienta de PC con su propia paleta.

## Tipografía

Las fuentes viajan **dentro del proyecto** (`public/fonts/`, woff2 con subconjunto latino, licencia SIL OFL): es una PWA y debe verse igual sin conexión, en Android y en PC.

- `--serif` → **Spectral** (300, 400, 400 cursiva, 600, 600 cursiva, 700): narración, diálogo, títulos y el reloj del teléfono.
- `--sans` → **Inter** (variable): interfaz, etiquetas y botones.
- `--mono` → monoespaciada del sistema, solo en desarrollo.
- Etiquetas en versalitas espaciadas (`text-transform:uppercase` + `letter-spacing`) y `font-variant-numeric:tabular-nums` en reloj, horas y dinero.

## Color

Todos los colores son variables (`--nombre` y `--nombre-rgb`, para transparencias: `rgb(var(--lamp-rgb) / .4)`). **No hay hexadecimales sueltos fuera de `base.css`.** Los blancos y negros con transparencia se escriben `rgb(255 255 255 / .1)`.

| Grupo | Variables |
|---|---|
| Noche (fondos) | `--void`, `--abyss`, `--abyss-2`, `--dusk`, `--dusk-2`, `--indigo`, `--plum`, `--plum-2`, `--mauve` |
| Luz y texto | `--cream` (texto), `--lamp` (acento cálido), `--lamp-deep`, `--lamp-soft`, `--paper`, `--ink-text` (texto sobre `--lamp`) |
| Texto atenuado | `--mist`, `--haze`, `--smoke`, `--frost` |
| Estado | `--danger`, `--danger-deep`, `--flame`, `--ok`, `--warn`, `--amber` |
| NorthLife | `--nl`, `--nl-link`, `--rose`, `--mint` |
| Desarrollo | `--dev`, `--dev-ink`, `--sky`, `--pink` |
| Alias semánticos | `--bg`, `--panel`, `--panel2`, `--text`, `--muted`, `--accent`, `--line`, `--glass`, `--ink`, `--ink-soft`, `--halo` |

El **mapa** usa siempre el tema `night` de `src/shared/mapStyle.js` (calles de tinta azul y ventanas encendidas); no cambia con la hora del día.

## Movimiento

Lento y «respirando» en el mundo; rápido (150–250 ms) en la interfaz. La elevación al pasar el ratón solo existe con `@media (hover:hover)` (en pantallas táctiles el estado se quedaba pegado). Se respeta siempre `prefers-reduced-motion`.

## Iconos

Trazo de 1,7 px, `stroke-linecap:round`; ✧ como firma de la Entidad. El icono de la app es `public/favicon.svg` (y sus PNG para el manifest).

## Reglas para quien toque el CSS

1. Un color nuevo = una variable nueva en `base.css`. Nada de `#rrggbb` en las demás capas.
2. Una regla vive en la capa a la que pertenece (Umbral, Mundo, Objetos o Desarrollo) y no se redefine en otra parte del archivo: se edita donde está.
3. Móvil primero: probar a 360×800 y 412×915; las zonas táctiles miden 44 px o más.
