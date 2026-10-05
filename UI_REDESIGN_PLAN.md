# Plan: auditoría y rediseño de la interfaz

Auditoría de la interfaz del juego hecha el **2026-10-04** jugando la app con Playwright: móvil emulado (Pixel, 360×732), además de 360×600 y 1280×800. Se recorrieron portada, Continuar, escena, las 6 apps del teléfono, NorthLife, Moverse, una conversación completa, la creación de personaje, la llegada, una acción narrativa, Partidas, Ajustes y el editor de mapas. Respeta [AGENTS.md](AGENTS.md) y se coordina con [MAP_SYSTEM_PLAN.md](MAP_SYSTEM_PLAN.md).

> **Importante para quien implemente:**
> - **Lo primero es la integración del mapa (§5, etapa 1)**: que el mapa del editor sea el mapa del juego, que funcione en el móvil y que los ids queden unificados. El resto de etapas va después, porque el mapa cambia el verbo "Ir", la barra superior, los avisos de tiempo, la hoja Moverse y la app Mapa.
> - [DESIGN.md](DESIGN.md) **no es el diseño de este juego**. Describe la web de Claude/Anthropic (crema, coral, Copernicus). No lo sigas; la etapa 3 lo sustituye por el sistema visual real (§4).

Prioridades: inmersión, claridad y personalidad de videojuego por encima de las tendencias genéricas de diseño web. No se trata de hacerlo "más moderno".

---

## 1. Problemas encontrados (de más a menos importante)

### Críticos: rompen el juego o la comprensión
1. **El toast invisible bloquea la fila de acciones.** El `#toast` se queda con `opacity:0` pero con `pointer-events:auto`, ocupando unos 310 px justo encima de las acciones ([styles.css:46](src/client/styles.css:46)). Tras cualquier `notify()`, "Moverse" y "Hablar con…" dejan de responder hasta recargar. Comprobado con `elementFromPoint`. Arreglo: `pointer-events:none`; además, no dejar el texto anterior ocupando espacio.
2. **Diálogo que aparece como narración, sin decir quién habla.** Al entrar o al salir de una conversación, la última frase del NPC queda en pantalla como si fuera el narrador ([game.js:215](src/client/game.js:215), `storyContent`). Además, el prólogo se muestra dos veces seguidas: en la pantalla de llegada y otra vez al entrar en la ciudad.
3. **La mayoría de las acciones quedan ocultas.** La fila de acciones mide 1083 px en una pantalla de 360: 4 de 6 no se ven y nada indica que se pueda deslizar. "Esperar", "Dormir" y "Trabajar" quedan al final. Mezcla moverse, social, ambientación y tiempo en una sola fila.
4. **El cuadro de texto no tiene marco y el texto se pierde.**
   - En respuestas largas, el nombre del NPC y el gesto desaparecen por arriba; a 360×600 no se ven nunca.
   - La narración se corta sin avisar de que hay más.
   - Las líneas anteriores se ven a medias encima del retrato.
   - No hay indicador de fin de línea ni de "continuar".
5. **Los cambios del juego no se ven.** El reloj saltó de 08:00 a 08:10 sin ningún aviso. La barra superior solo muestra el reloj: ni dinero, ni energía, ni el siguiente compromiso.

### Altos: rompen la inmersión
6. **La espera de la IA no se entiende.** El texto anterior parpadea atenuado con "· · ·", así que parece el texto nuevo, y no dice quién está pensando.
7. **Ajustes te saca del juego.** La app Ajustes del teléfono abre una página web: 6 botones apilados con el mismo peso visual, que mezclan IA, partidas, una herramienta de desarrollo ("Importar ficha") y una acción destructiva ("Olvidar API key"). En Partidas, cada partida tiene 4 botones iguales y se usan `prompt()`/`confirm()` nativos.
8. **Cinco estilos visuales que no se hablan entre sí:**
   - el Umbral (claro y luminoso),
   - el juego (noche y cristal),
   - los menús (tarjetas web oscuras, título en Inter negrita),
   - NorthLife (azul `#2f8fff`),
   - las herramientas de desarrollo (verde).

   Partidas y Ajustes son lo que más parece una aplicación web corriente.
9. **Las fuentes no se cargan.** No hay ningún `@font-face`: Inter y Georgia dependen del sistema. Android no tiene Georgia, así que el aspecto real en la plataforma principal es distinto del que se ve en el PC.
10. **El mapa no es un mapa.** Es una lista idéntica a la hoja "Moverse". Muestra tiempos absolutos por lugar en vez de calcularlos desde donde estás ("Apartamento 0 min" estando en el café). Aparece "Transit" en inglés y "Central" en casi todo. → Se resuelve con la **integración del mapa (etapa 1)**.

### Medios
11. **La portada no cabe a 360×732:** "Ajustes" queda cortado por `padding-top:min(35vh,260px)` ([styles.css:90](src/client/styles.css:90)).
12. **El nombre del lugar se repite:** el título de llegada se superpone al cartel dibujado de la escena ("Luna's Coffee" sobre "Luna's Coffee", "PORTA MAGNA" sobre "Estación Porta Magna").
13. **Teléfono:**
    - En móvil es un teléfono dentro de otro teléfono: el marco y la muesca se comen unos 40 px de cada lado.
    - La pantalla de inicio está medio vacía.
    - En NorthLife, la pestaña "Agenda" queda cortada.
    - El botón "+" flota a media pantalla cuando el feed está vacío.
    - El botón principal es azul en el feed y dorado en Chats.
14. **En escritorio** el juego es una columna de 480 px con el resto en negro.
15. **Accesibilidad:**
    - `.story` es una región `aria-live` que se rellena letra a letra, así que un lector de pantalla lo anunciaría sin parar.
    - El teléfono y la hoja de Moverse son `role=dialog` sin `aria-modal`, sin mover ni atrapar el foco, y la hoja no tiene botón de cerrar.
    - En la creación: "Atrás" al 50 % de opacidad y un anillo de foco dorado que casi no se ve sobre el fondo claro.
16. **Creación de personaje:**
    - La intro no se puede saltar: existe `.skip-story` en el CSS pero no se usa.
    - "Cuéntame un poco de ti" no avisa de que es opcional ni da pistas; Continuar aparece a los 3,2 s.
    - El texto largo de la llegada va centrado, lo que lo hace más difícil de leer.

### Bajos y deuda técnica
17. Todos los botones suben 2 px al pasar el ratón ([styles.css:67](src/client/styles.css:67)); en pantallas táctiles el estado se queda pegado.
18. El toast dice "¡Cuenta creada! **Bienvenida**…" también a personajes masculinos ([northlife.js:222](src/client/northlife.js:222)).
19. Salir de una conversación pide dos pasos ("Despedirte" → un "Volver" ambiguo). El Diario dice "Empezaste a hablar con alguien" sin decir con quién.
20. `favicon.ico` da 404, el manifest no tiene iconos y el `theme-color` (`#171b24`) no coincide con el fondo del juego (`#05070d`).
21. **CSS:**
    - `:root` se define dos veces.
    - `.vn-layer` se redefine tres veces con bloques de "ajuste final".
    - Hay unos 220 colores hexadecimales distintos sin variables; `#f2d6a8` aparece 37 veces.
    - Clases sin uso: `.shell`, `.topbar`, `.nav`, `.hero`, `.place-list`, `.prologue-card`, `.narrative-card`, `.creation-recap`, `.progress`, `.step-count`, `.settings-shortcut`.

---

## 2. Qué funciona bien y hay que conservar
- **El teléfono como menú dentro del mundo**, en lugar de una barra de pestañas. Es la mejor decisión de la interfaz.
- **El modo novela visual:** retrato grande, cambio de expresión sincronizado con el texto, escena desenfocada y oscurecida, texto que se escribe poco a poco y se completa con un toque.
- **Las escenas SVG** que cambian con la hora (`skyFor`) y el título de llegada.
- **La creación con la Entidad:** letras flotantes, vórtice que reacciona, la frase interrumpida antes del nombre.
- **Texto libre más acciones sugeridas**, con el formato `*acción*` / `"diálogo"`.
- **Bien resuelto técnicamente:** botón de detener la generación, un fallo de la IA no avanza la partida, `prefers-reduced-motion`, márgenes seguros, adaptación al teclado con `visualViewport`, la fila de acciones se oculta al escribir, efectos que se reducen solos en equipos lentos y zonas táctiles de 44–56 px.
- **NorthLife** como red social del mundo, con marca propia dentro del teléfono.
- **La "Vista final" nocturna del editor de mapas** (calles de tinta azul y ventanas encendidas): encaja con la estética nocturna del juego y es la base visual del mapa del juego.

---

## 3. Propuestas concretas

**Cuadro de texto (núcleo)**
- Convertirlo en un componente propio: placa con el nombre pegada al borde superior, marco fino ornamental y fondo propio en lugar de máscara degradada.
- Distinguir por forma, no solo por color:
  - Narrador: cursiva, sin placa.
  - NPC: placa con su nombre.
  - Jugador: a la derecha, con marco más ligero.
- Indicador ✧ que palpita al terminar cada línea y aviso "↓ más" si el texto desborda.
- Las líneas anteriores pasan a un historial (deslizando hacia arriba), no a una máscara medio transparente.
- La espera de la IA dice quién piensa ("Luna está pensando…", "La ciudad responde…") sin atenuar el texto anterior.
- La última línea siempre muestra quién la dijo.

**Cambios del juego y barra superior**
- Avisos breves de lo que decide el motor: "+10 min", "−$5", "Anotado en la Agenda". Son datos del motor, no de la IA.
- Barra superior: lugar y hora, dinero y el siguiente compromiso como recordatorio pequeño.

**Acciones**
- 3–4 verbos fijos siempre visibles: **Hablar · Explorar · Ir · Esperar**.
- "Ir" abre el **mapa** (etapa 1).
- Las acciones de ambientación del lugar viven dentro de "Explorar".
- Las personas presentes se muestran con su avatar encima de la fila de acciones ("quién está aquí").

**Menús y pantallas fuera de la partida**
- Partidas y Ajustes viven en el Umbral (fondo de vórtice, lenguaje de la Entidad), no en tarjetas web.
- Partidas como "libro de historias": Jugar destacado y el resto en un menú "⋯", con confirmación propia.
- Separar Ajustes en tres:
  - Juego: velocidad de texto, efectos, sonido.
  - Narrador (IA).
  - Desarrollo: solo en modo dev.
- La app Ajustes del teléfono abre una pausa dentro del juego.

**Teléfono**
- Por debajo de unos 420 px, el teléfono ocupa toda la pantalla sin marco.
- Widgets en la pantalla de inicio: siguiente cita, dinero, avisos de NorthLife.
- La app Mapa abre el mismo componente que "Ir".

**Escritorio**
- La escena ocupa todo el ancho y el texto y las acciones quedan en una columna de lectura.
- El teléfono puede ir como panel lateral.

---

## 4. Dirección visual: "Luz de ventana en una ciudad nocturna"

| Capa | Qué es | Lenguaje |
|---|---|---|
| **El Umbral** (pantallas fuera de la partida y la Entidad) | Lo sobrenatural | Luz pálida lila y celeste, tinta oscura, serif en cursiva, sigilo ✧. Ya existe en la creación; extenderlo a Partidas y Ajustes. |
| **El Mundo** (escena, texto, mapa) | Northfortress | Escena a pantalla completa, luz que cambia con la hora, **un solo acento cálido** (luz de lámpara, `#f2d6a8`), cuadro de texto ornamental fino. **El mapa usa siempre el estilo nocturno del editor** (calles de tinta azul y ventanas encendidas); es el aspecto oficial del mapa y no cambia con la hora. |
| **Los Objetos** (teléfono, diario) | Cosas del personaje | El teléfono moderno y creíble (aquí sí cabe el azul de NorthLife) y el diario con aspecto de papel. |

**Reglas comunes**
- **Fuentes:**
  - Serif de lectura con carácter para narración y diálogo (Spectral, Fraunces o Cormorant).
  - Sans para la interfaz (Inter o IBM Plex).
  - Las dos **incluidas en el proyecto como woff2**, porque es una PWA y debe funcionar sin conexión. Nada de Google Fonts en tiempo de ejecución.
  - Etiquetas en versalitas espaciadas y `tabular-nums` en reloj y dinero.
- **Colores:** unas 12 variables (`--ink`, `--glass`, `--line`, `--lamp`, `--threshold-light`, `--danger`, más los propios de NorthLife y de desarrollo). Ningún hexadecimal suelto fuera de ellas.
- **Animación:** lenta y "respirando" en el mundo y rápida (150–250 ms) en la interfaz. Elevación al pasar el ratón solo con `@media (hover:hover)`. Mantener `reduced-motion`.
- **Iconos:** trazo 1.7 (como ahora) y ✧ como firma de la Entidad.

---

## 5. Etapa 1 (prioridad): integrar el mapa de Northfortress en el simulador

Es lo primero que hay que hacer. Corresponde al hito 2 y a la parte jugable del hito 3 de [MAP_SYSTEM_PLAN.md](MAP_SYSTEM_PLAN.md).

**Contexto del autor (2026-10-04):**
- El mapa guardado es **representativo** y va a cambiar mucho (formas, posiciones, lugares nuevos). Lo que tiene que ser real y definitivo es **el sistema de integración**: nada de coordenadas, ids ni lugares escritos a mano en el código.
- **Porta Magna no es una ciudad:** es la central o estación más importante de la línea de metro. El mundo que se recorre es Northfortress.
- **El estilo nocturno del editor ("Vista final", tema `night`) es el aspecto oficial del mapa en el juego.**
- Los 5 lugares del mapa **son los mismos** que los provisionales del juego; sus ids eran provisionales porque no se conocían los reales. Se pueden cambiar los ids libremente para no romper el motor, **siempre que el jugador vea el nombre que el autor puso a cada lugar en el editor**.

### 5.1 Lo que hay hoy

[data/canon/maps/northfortress.json](data/canon/maps/northfortress.json) usa el esquema v2, en metros:
- 5 lugares, 1 distrito (`northfortress_2` "NorthFortress"), 17 calles, 11 áreas y terreno.
- 0 enlaces, sin horarios, todos con `kind:"poi"`, descripciones vacías y `publish:null`.
- La ciudad mide unos 1,5–2 km y el lienzo completo unos 8 km.

El motor carga los lugares desde [data/canon/locations/porta_magna.json](data/canon/locations/porta_magna.json), en [index.js:32](src/server/index.js:32) (`worldData`). Cada lugar tiene un `travelMinutes` fijo, vengas de donde vengas. Ese `worldData` se usa en todo el servidor:
- `ambientHeader`, `narrate`, `prologue`, `validateAgreements`, `/api/world`, la validación de `locationId`, `mapContext.legacyIds`;
- [ambient.js:27](src/server/ai/ambient.js:27);
- [tools/game.js:57](src/server/ai/tools/game.js:57) y [tools/game.js:101](src/server/ai/tools/game.js:101).

En el cliente, `place(id)` busca en `state.world.locations`, y la hoja Moverse y la app Mapa son listas con `loc.travelMinutes` ([game.js:341](src/client/game.js:341)).

### 5.2 Ids: se unifican a los que ya usa el motor

| Nombre (lo que ve el jugador; lo pone el autor en el editor) | Id provisional en el mapa | **Id definitivo** (ya lo usan guardados, la ficha de Luna, `SCENE_META`, horarios y `probe.js`) |
|---|---|---|
| Luna's Coffee | `lunacoffee` | `cafe` |
| Estacion Porta Magna | `porta_magna` (⚠ además choca con el id del mundo) | `station` |
| Apartamento | `apartamento` | `apartment` |
| Parque | `parque` | `park` |
| Tienda "MiniMarket" | `tienda1` | `store` |

- Renombrar los ids **en el JSON del mapa** (o con el editor). Así no hay que migrar guardados ni fichas.
- **El nombre visible sale siempre del campo `name` del mapa**, nunca de `porta_magna.json`. Por ejemplo, la tienda pasa a mostrarse como «Tienda "MiniMarket"».
- Copiar al mapa lo que hoy solo está en `porta_magna.json`: `hours` del café (6–22) y de la tienda (8–21), y las descripciones. El `kind` sirve para elegir la escena por defecto.
- El distrito visible es el del mapa ("NorthFortress"). Desaparecen "Central" y "Transit".
- Tests:
  - el mapa del juego define todos los lugares que usan las fichas de NPC (`home`, horarios) y `SCENE_META`;
  - un guardado con un `locationId` que ya no existe se carga igualmente.

### 5.3 Motor: `src/server/game/geography.js` (fuente única de lugares)

- **Qué mapa es el del juego:** añadir `mapId: "northfortress"` a los datos del mundo. Se puede renombrar `porta_magna.json` a un archivo del mundo, por ejemplo `data/canon/world.json` con `{ id, name, mapId, walkMetersPerMinute, minTravelMinutes }`; la decisión de nombre es de quien implemente.
  - `porta_magna.json` deja de definir lugares.
  - El id interno `cityId:'porta_magna'` de los guardados se puede mantener por compatibilidad ([run.js:29](src/server/game/run.js:29)).
- **Interfaz compatible con lo de ahora:** `geography.world()` devuelve `{ id, name, locations:[{ id, name, district, description, hours, kind, x, y }] }`. Así casi todo el código que usa `worldData.locations` sigue igual. El `name` del mundo sale del mapa ("NorthFortress").
- **Tiempo de viaje relativo y determinista:** `travelMinutes(fromId, toId)` = `max(minTravelMinutes, round(distancia / walkMetersPerMinute))`.
  - Propuesta: 80 m/min y un mínimo de 2 min.
  - Con el mapa actual sale: café → estación 23 min, café → apartamento 19, apartamento → tienda 3.
  - Tope de tramo a pie según MAP_SYSTEM_PLAN §1.
  - Lo calcula el motor; la IA solo narra.
- **Sustituir todos los `travelMinutes` fijos:**
  - `travel` en [tools/game.js](src/server/ai/tools/game.js): usa el tiempo relativo y devuelve `{ minutes, distance }`.
  - `place_info`: devuelve los minutos desde el lugar actual.
  - [ambient.js:27](src/server/ai/ambient.js:27): cabecera "id — nombre: N min desde aquí".
- **Recarga en caliente**, como `socialCatalog`: si el autor guarda el mapa en el editor, el juego lo usa sin reiniciar.
- **El sistema aguanta los cambios del mapa:**
  - Si una partida está en un lugar que ya no existe, se la manda al lugar de inicio (`spawn`, la estación) con un aviso en el log. Nunca se cae.
  - Si un lugar no tiene escena en `SCENE_META`, se usa una escena genérica por `kind`.
  - Validar al arrancar con `validateMap`. Si el mapa no es válido, se usa el último bueno (`.backup`) y se avisa.
- **Llamadas a la IA:** un viaje con botón ya hace `applyAction` + `ai.narrate`, y si la narración falla no se guarda nada. Eso se mantiene (AGENTS.md: un fallo de IA nunca avanza la partida).
- **Textos fijos con "Porta Magna como ciudad"** que hay que alinear con el lore. ⚠ La redacción de lore la confirma el autor:
  - [provider.js:177](src/server/ai/provider.js:177): el prompt del prólogo dice "la ciudad nexo".
  - [social.js:499](src/server/game/social.js:499): `ciudad: 'Porta Magna'`.
  - [game.js:487](src/client/game.js:487): "La partida comenzó en Porta Magna".
  - [app.js:319](src/client/app.js:319): el texto de llegada.
  - [scenes.js:1](src/client/scenes.js:1): el comentario.

  Lo que ve el jugador como nombre del mundo debe salir de los datos (mapa o mundo), no del código.
- **Tests** junto a `tests/maps.test.js`:
  - tiempos relativos y mínimo;
  - ids desconocidos;
  - recarga del mapa;
  - guardado antiguo con lugar inexistente;
  - `/api/world` sin `travelMinutes` fijos.

### 5.4 Cliente: el mapa en el juego (móvil primero)

**Un solo componente** (`src/client/worldmap.js`) que se abre desde dos sitios: el verbo "Ir" de la fila de acciones y la app Mapa del teléfono. Sustituye a la hoja "¿A dónde vas?" y a la lista de la app Mapa. Reutiliza [mapview.js](src/client/mapview.js) y [maprender.js](src/client/maprender.js) con el **tema nocturno fijo y la vista final**. No tiene herramientas de edición: el modo jugador es solo lectura.

**Que funcione en móvil (requisito, no extra):**
- **Gestos en `MapView`** (hoy solo hay rueda y arrastre de ratón):
  - pellizcar para hacer zoom, con dos punteros y la propiedad `touch-action:none` en el contenedor;
  - arrastrar con un dedo para mover el mapa;
  - doble toque para acercar.

  Los gestos van en `MapView`, así que el editor también los gana.
- **Zonas táctiles:**
  - cada lugar responde a un toque en un radio de 22 px o más;
  - los nombres no se pisan entre sí (ahora "Parque" y "Apartamento" se solapan): si chocan, se oculta el menos importante;
  - el nombre del lugar más cercano al jugador siempre se ve.
- **Rendimiento:**
  - limitar la densidad de píxeles del canvas (×2 como máximo);
  - redibujar con `requestAnimationFrame` y solo lo visible;
  - nivel de detalle según el zoom (casas y árboles solo de cerca);
  - si va lento (`fx-lite` o menos de 30 fps), quitar el postproceso WebGL y dejar el tema `night` plano.

  Medirlo en Android real o en Playwright móvil antes de cerrar la etapa. Las teselas horneadas del exportador vienen después; esta etapa no depende de ellas.
- **Encuadre inicial:** centrado en el jugador, con un zoom en el que se vea su barrio. Botón "Centrar en mí".
- **Sin bloquear la interfaz:** el mapa es una capa a pantalla completa con botón de cerrar visible, Escape y gesto atrás del sistema (`history.pushState`). El foco entra al abrirlo y vuelve al cerrarlo.
- **Vista de lista** (Mapa / Lista) con los mismos datos, por accesibilidad y como respaldo en equipos lentos.

**Elementos en el mapa:**
- Marcador del jugador: un punto con halo cálido, del acento `--lamp`.
- Los lugares con nombre.
- El distrito, como etiqueta.

**Hoja del lugar** (al tocarlo, sube desde abajo):
- Nombre (el del autor) y distrito.
- Abierto o cerrado según `hours` y la hora del mundo.
- Distancia y minutos a pie desde donde estás.
- **Hora de llegada** ("llegarías a las 09:04").
- Quién suele estar ahí, solo si el jugador ya lo sabe.
- Botón **Ir**.

**Viaje (la mejora de inmersión que se busca):**
1. Al pulsar Ir, el marcador del jugador **recorre el trayecto** en línea recta mientras el reloj de la barra superior avanza hasta la hora de llegada. Por ahora no hay rutas por calles (MAP_SYSTEM_PLAN §0); más adelante podrá seguir el grafo de calles.
2. La animación dura de 1,5 a 3 s, según la distancia.
3. La petición al servidor sale al empezar. **Si el servidor falla, el marcador vuelve al origen y se muestra el error**: el motor manda, y la animación nunca da por hecho el viaje.
4. Si el servidor responde bien, el mapa se funde con la escena del destino y aparece el título del lugar (sin repetir el cartel dibujado en la escena).

Con `reduced-motion`: sin animación, solo el fundido.

Si hay una conversación abierta, "Ir" muestra "Despídete antes de irte" en la propia hoja, como ahora.

### 5.5 Cierre de la etapa 1
- Se juega un día entero en el móvil (360×800 y 412×915) moviéndose solo por el mapa: pellizcar, mover, tocar un lugar, Ir, llegar.
- Los tiempos dependen del origen. El jugador ve los nombres del editor. Los guardados existentes (`cafe`, `station`…) siguen cargando.
- Si el autor mueve un lugar o añade uno nuevo en el editor y guarda, el juego lo refleja sin tocar código.
- `npm test` pasa, con los tests nuevos de geografía.
- **Prerrequisito de una línea:** arreglar antes el toast que bloquea los toques (§1.1, `pointer-events:none` en [styles.css:46](src/client/styles.css:46)); si no, tapa la fila de acciones durante las pruebas.

---

## 6. Cambios estructurales y cambios visuales

| Estructural (estructura, JS o flujo) | Puramente visual (CSS o textos) |
|---|---|
| **Integración del mapa** (ids, `geography.js`, mapa en el juego, gestos táctiles, viaje animado) | Arreglo del toast (`pointer-events`) |
| Cuadro de texto con historial; atribución de la última línea | Variables de color y espaciado; borrar CSS sin uso y bloques duplicados |
| Verbos fijos y "quién está aquí" | Fuentes incluidas en el proyecto |
| Barra superior con estado y avisos de cambios | La portada cabe; sin título duplicado sobre el cartel |
| Partidas y Ajustes rediseñados; pausa dentro del juego; confirmaciones propias | Contraste y anillo de foco en el Umbral |
| Teléfono a pantalla completa en móvil y widgets | Elevación solo con `(hover:hover)` |
| Diálogos modales accesibles (foco, cerrar) | Pestañas de NorthLife, botón "+", color de los botones |
| Opción de saltar la intro; distribución para escritorio | `theme-color`, favicon, iconos del manifest; textos ("Bienvenida", "con alguien") |

---

## 7. Plan de implementación por etapas

**Estado (2026-10-04): la etapa 1 está implementada** (ver «El mapa en el juego» en el README); las demás siguen pendientes.

Al cerrar cada etapa: `npm test`, arranque verificado, capturas con Playwright a **360×600, 360×800, 412×915 y 1280×800**, y una partida completa (llegar → hablar → despedirse → ir a otro lugar por el mapa). Una partida de prueba nunca debe sobrescribir guardados reales (duplicar antes o usar un directorio aparte).

| # | Etapa | Contenido | Cierre cuando… |
|---|---|---|---|
| 1 | **Integración del mapa (prioridad)** | §5 completo: ids unificados con los nombres del autor, `geography.js` como fuente única con tiempos relativos y recarga, mapa nocturno en el juego con gestos táctiles, hoja del lugar con hora de llegada, viaje animado, vista de lista; sustituye a la hoja Moverse y a la app Mapa | §5.5 |
| 2 | **Arreglos inmediatos** | La portada cabe; elevación solo con `(hover:hover)`; texto "Bienvenida"; favicon, `theme-color` e iconos; sin `aria-live` durante el texto letra a letra (anunciar la línea completa al terminar) | La portada se ve entera a 360×732 |
| 3 | **Base visual** | Variables de color y espaciado (incluidas las del mapa nocturno); fuentes woff2 en el proyecto; reorganizar `styles.css` y `game.css` por capas (Umbral, Mundo, Objetos) sin redefiniciones; borrar CSS sin uso; **sustituir DESIGN.md** por §4 | Sin hexadecimales sueltos fuera de las variables; mismo aspecto en Android y en PC |
| 4 | **Cuadro de texto y narración** | Componente de diálogo con placa, ✧ e historial; atribución correcta; espera que dice quién piensa; avisos de cambios (+min, ±$, Agenda) | Ninguna línea queda sin dueño; ningún texto se corta sin aviso |
| 5 | **Acciones y barra superior** | Verbos fijos (Hablar · Explorar · **Ir → mapa** · Esperar), "quién está aquí", barra con lugar, hora, dinero y siguiente compromiso | Todas las acciones a la vista o a un toque, sin deslizar a ciegas |
| 6 | **Pantallas fuera de la partida en el Umbral** | Partidas como libro de historias, Ajustes separados (Juego / Narrador / Desarrollo), pausa dentro del juego, confirmaciones propias (sin `prompt`/`confirm`) | Ninguna pantalla parece un formulario web |
| 7 | **Teléfono** | Pantalla completa en móvil, widgets, arreglos de NorthLife (pestañas, botón "+", un solo color principal); la app Mapa ya abre el mapa de la etapa 1 | El inicio del teléfono es útil de un vistazo |
| 8 | **Escritorio, accesibilidad y pulido** | Distribución ancha (el mapa puede usar todo el ancho); diálogos con foco atrapado; contraste del Umbral; saltar la intro; texto de la llegada alineado a la izquierda | Navegable con teclado; contraste AA en todas las capas |

### Decisiones ya tomadas por el autor (2026-10-04)
- La integración del mapa va primero. El mapa actual es representativo y cambiará; el sistema tiene que ser real.
- Los ids pueden cambiar; el jugador ve los nombres puestos en el editor.
- Porta Magna es la estación principal del metro, no una ciudad. El mundo es Northfortress.
- El estilo nocturno del editor es el aspecto oficial del mapa.

### Decisiones pendientes del autor
1. La redacción de lore en los textos que tratan a Porta Magna como ciudad (prompt del prólogo, `social.js`, textos de llegada y del Diario).
2. Fuentes concretas (serif de lectura y sans de interfaz).
3. Velocidad a pie y mínimo por trayecto (propuesta: 80 m/min y 2 min).
4. Si el nombre del mapa en el juego se escribe "NorthFortress" (como en el editor) o "Northfortress" (como en el lore).
