# Plan: mapa, editor de mapas y viajes

Plan de trabajo del sistema de mapa. Complementa a [AI_ENGINE_REDESIGN.md](AI_ENGINE_REDESIGN.md) (herramientas y conocimiento del modelo) y respeta [AGENTS.md](AGENTS.md): el canon vive en `/data/canon`, el estado de la partida en el guardado, la IA interpreta y el motor decide tiempo, dinero y lugar. **Revisado el 2026-10-03** (se descartó la esfera y el editor pasó a ser parte del motor) **y el 2026-10-04** (se aprobó el esquema v2: mapa vectorial en metros, ver §1 y §7).

## 0. Decisiones tomadas

| Tema | Decisión |
| --- | --- |
| Mundo | **Northfortress** es un país/facción cuya capital se llama igual. Hearstone, Porta Magna y otras ciudades pequeñas forman parte de él. Porta Magna es la estación que conecta con la capital (y con otras facciones por metro). Tamaño en juego: un país mediano (sin definir). |
| Mapa | **Plano**, sin esfera. Un lienzo vectorial en **metros** por mapa (sin imagen obligatoria), con áreas, caminos, distritos y lugares visitables (checkpoints). El diseño admite mapas anidados (país → ciudad) pero se empieza con uno. |
| Arte | Lo hace el autor. La imagen generada con IA que se usó de referencia no es canon. |
| Distancia y tiempo | Por coordenadas: distancia en metros entre dos puntos (1 unidad = 1 m, ya no hay escala que calibrar). Sin rutas por calles. |
| Transporte | Solo **caminar** y **taxi**. Después, transporte personal. **No hay red de transporte público**: el único medio especial es el **metro de Porta Magna**, que se modela como un enlace escrito a mano entre lugares, no como paradas y líneas. |
| Ids | Texto legible en minúsculas con guiones bajos (`luna_cafe`), únicos en todo el juego. Lo que ve el jugador es distinto; lo único importante es que modelo y motor se entiendan. |
| Integración | **No se integra el mapa en el juego hasta que el editor sea mínimamente funcional.** Sin boceto previo. |
| Estética | El color y el estilo (shader) se aplican **al exportar** el mapa a teselas horneadas; el juego no calcula shaders en tiempo real. El editor usa colores base provisionales. |
| Relleno | Los edificios y árboles **no se guardan**: los genera un algoritmo con semilla a partir de la receta de cada área (estilo orgánico preferido). Un camino tiene prioridad: parte el relleno que cruza. |
| Grupos | Todo se arma en grupos anidables (ciudad, facción…). Un grupo terminado se puede **bloquear** (no recibe cambios) y, más adelante, **hornear**. |
| Medidas | Realistas: manzana 60–140 m, casa ~12×16 m, calle de barrio 8–12 m, avenida 16–30 m, distrito 0,5–2 km, ciudad 3–8 km. |
| GeoJSON | Descartado como prioridad: el autor es el único que crea el mapa. Solo se considerará si ayuda al motor (datos espaciales). |
| Editor | **Parte del motor, no una herramienta aparte.** Un mismo componente de mapa sirve en dos modos (§2): edición de canon (desarrollo, solo PC) y colocación de elementos del jugador (su casa, propiedades, marcas), con otros permisos. |

## 1. Modelo de datos (esquema v2)

Un archivo por mapa en `data/canon/maps/<mapId>.json`, JSON ordenado de forma estable (diferencias limpias en git). Coordenadas en **metros del mundo** (x hacia el este, y hacia el sur), lienzo sin límite. Los mapas del esquema v1 (sobre una imagen) se convierten solos al leerlos.

```
schemaVersion: 2, id, name, units: 'm', style { theme },
underlays[] { id, file, width, height, x, y, metersPerPixel, opacity, visible }   // imágenes de calco OPCIONALES, assets/maps/<file>
areas[]     { id, name, kind, polygon[[x,y]…], z, fill, group }                   // agua, tierra, bosque, zona urbana…; fill = receta con semilla
ways[]      { id, name, kind, points[[x,y]…], width, z, group }                   // avenida, calle, sendero, río, muralla, vía, puente
districts[] { id, name, color, polygon, fog, allowPlayerPlaces, group }           // zonas de juego
places[]    { id, name, aliases[], kind, x, y, district, access, hours, tags[], description,
              discovery, owner, footprint?, group, requires[] }
links[]     { id, name, mode, from, to, minutes|null, cost, requires[], distanceKm|null, path[[x,y]…], line, twoWay }   // conexiones reales (carretera, ferrocarril, Northline, ruta marítima…)
lines[]     { id, name, mode, color }                                              // líneas de transporte (Línea Este…): agrupan enlaces con un color
decor[]     { id, name, kind, x, y, size, rotation, group }                        // decoración y etiquetas de texto (solo visuales)
travel      { speedsKmh: { modo: km/h } } | null                                   // velocidades propias del mapa para calcular tiempos
groups[]    { id, name, parent, locked, baked }                                   // árbol; el bloqueo se hereda hacia abajo
publish     { version, builtAt, sourceHash, format, tileSize, minZoom, maxZoom, bounds } | null   // metadatos de las teselas exportadas
```

- **Área y relleno:** `fill.pattern` ∈ `none` / `organic` / `grid` / `radial` / `forest`, con `seed`, `blockSize`, `lotSize`, `density`, `streetWidth`, `rotation` (y `center`, `rings`, `spokes` en radial; `treeSpacing` en bosque). Salirse de los rangos realistas da un aviso, no un error.
- **Grupos:** un elemento bloqueado por su grupo o por un ancestro no se edita (el editor lo congela). `baked` (reservado) nombrará el archivo con el relleno generado y congelado de un grupo terminado.
- **Lugar (`place`)**: `kind` ∈ `home`, `food`, `shop`, `poi`, `transport`, `gateway`, `other` y, para mapas regionales, `capital`, `city`, `town`, `station`, `district`, `port`, `facility`; además `importance` (1–5), `icon`, `faction`, `image` y `data` (pares clave → valor para el simulador); `access` ∈ `public` / `private` / `restricted`; `discovery` (estado inicial) ∈ `hidden` / `rumor` / `known`; `owner` = id de NPC opcional; `requires` = requisitos de acceso (`escort`, `invitation`, `story_flag`, `knows_place`, `money`), tipos cerrados que valida el motor; el modelo nunca los concede.
- **Distrito**: polígono (en m²) para la niebla y para asignar el distrito de cada lugar. `allowPlayerPlaces` marca dónde el jugador puede colocar su casa o marcas (§2.2).
- **Enlace (`link`)**: arista escrita a mano entre dos lugares (el metro de Porta Magna con la capital y otras facciones). Duración y costo los pone el autor; no hay cálculo de rutas.
- **Estado en la partida (no en el canon):** `run.knowledge.places[id] = { state: hidden|rumor|known|visited, via, at }`, `run.flags` para hitos de historia, y **`run.places`** para lo que crea el jugador (§2.2). Las partidas existentes no se rompen: sus lugares actuales pasan a «conocido».

### Ids
Únicos en todo el juego, no solo por mapa. Inmutables en la práctica (partidas, horarios de NPC y citas los referencian): el editor avisa dónde se usa cada id antes de renombrarlo y guarda `idAliases` (`viejo → nuevo`) que el motor aplica al cargar partidas antiguas. Los ids de lugares del jugador llevan prefijo `mine_` para no chocar con el canon. El modelo recibe pares «id — nombre» solo de lo que el jugador conoce; si responde con un nombre, `travel` rechaza con la lista de ids válidos (ya funciona así).

### Mapas grandes
Un país mediano hace que ir a pie a otra ciudad sea absurdo. Regla del motor: **un tramo a pie tiene tope de duración** (valor configurable, p. ej. 3 h); por encima, `travel` rechaza con el motivo y sugiere taxi, con tiempo y costo. El taxi recorre cualquier distancia con velocidad y tarifa propias.

## 2. El editor dentro del motor

### 2.1 Un componente, dos modos
- **`MapView`** (cliente): visor reutilizable con paneo y zoom (rueda y arrastre; en móvil, gestos), conversión pantalla ↔ coordenadas normalizadas, capas (imagen, polígonos, marcadores) y eventos de puntero. Lo usan el editor de canon, la pantalla de mapa del juego y la colocación del jugador.
- **Módulos compartidos** (`src/shared/`): geometría (distancia, punto en polígono, validez de polígonos) y validador de esquema. Se importan igual desde el navegador y desde Node, así que el editor y el motor validan exactamente lo mismo, y se prueban con tests.

### 2.2 Modo desarrollo (canon) y modo jugador
| | Desarrollo (PC) | Jugador |
| --- | --- | --- |
| Qué edita | Imagen, escala, distritos, lugares, enlaces del canon | Solo lugares propios (`run.places`): su casa al crear el personaje, propiedades si se añade comprarlas, marcas con nota |
| Dónde guarda | `data/canon/maps/*.json` y `assets/maps/*` (con copia de seguridad y escritura atómica) | En el guardado de la partida |
| Permisos | Rutas `/api/dev/maps` protegidas por la cabecera de desarrollo y solo en localhost; sin gestos móviles (PC) | Rutas de partida; cada alta pasa por el **motor**, que valida y puede rechazar |
| Reglas | Validación del esquema (ids únicos, polígonos válidos, referencias existentes…) | Solo en distritos con `allowPlayerPlaces`; punto dentro del polígono; no encima de un lugar existente (distancia mínima); número máximo; nombre limpio y de longitud limitada; id generado por el motor (`mine_1`…) |

Un lugar del jugador es un lugar más para el viaje, la niebla y el modelo, pero el modelo **no puede crearlos ni moverlos**: lo decide la interfaz y lo valida el motor. Comprar propiedades, si llega, solo cambia `owner` y `price` de un lugar.

### 2.3 Funciones del editor de canon (v1)
Subir imagen · **calibrar la escala** (línea de referencia con su largo en metros) · dibujar **distritos** (polígonos con vértices editables, nombre, id, color, niebla inicial, `allowPlayerPlaces`) · colocar **lugares** (id generado a partir del nombre con control de colisiones, nombre, alias, tipo, acceso, horario, etiquetas, descripción, descubrimiento, dueño; el distrito se asigna solo) · herramienta de **medir** (distancia en metros y minutos a pie y en taxi entre dos puntos) · deshacer/rehacer · lectura de coordenadas · **panel de validación** en vivo (clic = ir al elemento) · guardado seguro. Más adelante: enlaces, matriz de tiempos, importación de los 5 lugares provisionales de `porta_magna.json`, vista previa de la niebla.

### 2.4 Validación (compartida con el motor)
Ids duplicados o mal formados (también frente a otros mapas y frente a los ids que ya usan los NPC) · lugares fuera de todo distrito · polígonos con autointersección o casi vacíos · distritos solapados (aviso) · escala sin calibrar · coordenadas fuera de 0–1 · imagen ausente o con otras proporciones · enlaces con extremos inexistentes · referencias rotas desde `home` y horarios de los NPC.

## 3. Integración en el simulador

- **Motor** (`src/server/game/geography.js`, con recarga en caliente como `socialCatalog`): catálogo de mapas con fachada compatible con `worldData.locations`; distancia → tiempo a pie o en taxi con **mínimo** (ningún viaje es instantáneo) y tope de tramo a pie; opciones de viaje; requisitos y conocimiento; tramos con enlaces. Cada viaje devuelve `{ minutos, costo, energía }` (la energía queda prevista).
- **Conocimiento:** el catálogo se filtra por lo que el jugador conoce **antes** de llegar a la cabecera del GM, `place_info` o `travel`. Revelado por visita, hitos de historia, una cita aceptada en ese lugar, o porque un personaje lo cuenta (herramienta `reveal_place` validada como `share_contact`).
- **Herramientas del modelo:** `travel(place, mode?)` con motivo y pista al rechazar («a pie son 38 min; en taxi, 12 min y 8 de dinero»); consulta `travel_options(place)`; la cabecera lista solo los lugares conocidos más cercanos (encaja con el recorte de contexto de la Fase 4).
- **Cliente del juego:** pantalla de mapa (sustituye al selector «¿A dónde vas?») con niebla por distrito, ubicación del jugador, hoja con detalle y hora de llegada, y lista de respaldo.
- **Citas encadenadas y acompañantes (último hito):** una cita empieza en el lugar acordado y continúa en otro; mientras dura, el acompañante va con el jugador (`run.party`) y el destino puede ser desconocido; un lugar con `requires: escort` rechaza el viaje directo con «no sabes cómo llegar».

## 4. Hitos (cada uno se puede probar y dejar funcionando)

| # | Hito | Cierre cuando… |
| --- | --- | --- |
| 1 | **Cimientos y editor de canon v1:** módulos compartidos (geometría, esquema), almacén de mapas en el servidor con rutas de desarrollo, `MapView` y editor (imagen, escala, distritos, lugares, medir, validación, guardado) | Se dibuja la cafetería y la casa de Luna sobre tu imagen, pasa la validación y el archivo queda en `data/canon/maps/` |
| 2 | **Motor: geografía** (catálogo con recarga, tiempos por coordenadas a pie y en taxi, tope de tramo, filtro por conocimiento, migración del mapa provisional) | `travel` ya no es instantáneo y el modelo no ve lugares ocultos |
| 3 | **Mapa en el juego** (solo lectura): niebla por distrito, ubicación, viajar desde el mapa | Se juega un día entero moviéndose por el mapa en el móvil |
| 4 | **Taxi y costos**, hoja de opciones con hora de llegada | Llegar tarde a una cita rompe el compromiso y la interfaz lo avisó |
| 5 | **Descubrimiento** (visita, cita, historia, `reveal_place`) | Luna revela su casa solo con las condiciones de su ficha |
| 6 | **Lugares del jugador** (su casa al crear el personaje, marcas) | La casa elegida en la creación aparece en el mapa y se puede usar en el viaje |
| 7 | **Enlaces** (metro de Porta Magna) y editor de enlaces | Viajar a la capital por el metro con su costo y requisitos |
| 8 | **Acompañantes y citas encadenadas** | Una cita de «recoger y llevar a» se cumple de punta a punta |

El valor jugable aparece de verdad en los hitos 5 a 8; el 3 solo es visual.

### Estado de los hitos
- **Hito 1: hecho (2026-10-03), reescrito al esquema v2 (2026-10-04):** lienzo infinito en metros, áreas con receta de relleno, caminos, grupos con bloqueo, capas de calco opcionales, imán a vértices; 157 tests en total. **Generador de relleno hecho (2026-10-04):** `src/shared/mapGen.js` (orgánico, cuadrícula, radial y árboles; caminos y lugares con prioridad; agua/plazas/parques sin edificar; vista previa en vivo en el editor sobre un canvas entre dos capas SVG; 17 tests). **Cuchillo, estilos y selección múltiple hechos (2026-10-04):** los caminos cortan las manzanas (`polygonClipping.js`, MIT, empaquetado); `mapStyle.js` + `maprender.js` pintan el mapa con 4 estilos y un shader WebGL de postproceso (vista final en el editor, ajustable); selección por rectángulo/Ctrl+clic y asignación a grupos en bloque (`mapSelect.js`); clic derecho quita el último punto al dibujar. 189 tests. **Terreno con pinceles y bosques tupidos hechos (2026-10-05):** `mapTerrain.js` (rejilla por trozos comprimidos, pincel/bote/suavizar, generador por ruido, contornos naturales, árboles y montañas por trozos con semilla y LOD), pestaña «Terreno» y herramienta «Pincel»; los bosques de polígono también pasan a copas solapadas. 208 tests. Pendiente del terreno: que forme parte de los grupos/bloqueos, caminos que sigan la orilla, y exportarlo con las teselas. Lo siguiente es: muros con torres y puentes, el **horneado de grupos** y el **exportador a teselas** (usará `maprender.js`).
- Detalle del hito 1 original (esquema v1): Módulos compartidos (`src/shared/`), almacén y rutas de desarrollo (`src/server/game/maps.js`, `/api/dev/maps`), `MapView` y el editor (`/mapeditor.html`), con 14 tests (geometría, esquema, almacén, API y servido de los archivos del editor). Verificado a mano en el navegador con la imagen de referencia: colocar lugares, dibujar un distrito (cierre por doble clic), calibrar escala, medir, mover marcadores, guardar. Pendiente del editor: vista previa de la matriz de tiempos, importación de lugares provisionales con posiciones útiles, edición de enlaces con más ayuda, y herramienta para que el jugador coloque su casa (hito 6).
- **Hito 2, parte hecha (2026-10-04):** `src/server/game/geography.js` es la fuente única de lugares y tiempos (mapa designado por `data/canon/world.json`, ids unificados con los del motor, tiempos a pie relativos al origen con mínimo y tope de tramo, recarga en caliente, último mapa bueno si el guardado no es válido, guardados con lugares borrados vuelven al inicio); 12 tests nuevos en `tests/geography.test.js`. Pendiente del hito: taxi y costos, filtro por conocimiento.
- **Hito 3, parte hecha (2026-10-04):** mapa nocturno en el juego (`src/client/worldmap.js`) con gestos táctiles, hoja del lugar con hora de llegada, viaje animado y vista de lista; lo abren el verbo «Ir» y la app Mapa. Pendiente: niebla por distrito, descubrimiento y teselas horneadas.
- **Siguiente:** resto del hito 2 (taxi, conocimiento) y hito 4.

## 5. Riesgos
- **Imágenes grandes en móvil:** varios MB; variantes reducidas, carga perezosa y nada precacheado en el service worker.
- **Contenido frente a sistema:** un país mediano con pocos lugares con vida se siente vacío; la niebla ayuda. Construir por cortes verticales (la zona de Luna), no el mundo entero.
- **Renombrar ids:** rompe referencias; mitigado con avisos del editor e `idAliases`.
- **Línea recta frente a ríos y murallas:** factor de rodeo por defecto y por pareja de distritos; calles solo si hace falta.
- **Editor dentro del motor:** las rutas de escritura de canon solo existen en modo desarrollo y en localhost; el modo jugador nunca recibe escritura sobre el canon.
- **Alcance:** `AGENTS.md` pide no implementar todo el lore del MVP: un mapa y un par de enlaces de prueba antes que todo el país.

## 6. Pendiente de decidir
1. Tamaño del país (km de ancho), para calibrar velocidades de caminar y de taxi y el tope de tramo a pie.
2. Cuántos mapas al inicio y si la capital tendrá su propio mapa de ciudad además del mapa del país.
3. Costo y velocidad del taxi.
4. Qué distritos admiten que el jugador coloque su casa.

## 7. Mapa vectorial procedural en el propio editor (APROBADA el 2026-10-04; paso 1 hecho)

Decisiones del autor: el color/estética se hornea al exportar (sin shaders en el juego); estilo orgánico preferido; las calles son líneas con prioridad que parten los polígonos; todo en grupos bloqueables; medidas realistas; GeoJSON sin interés.

Nace de dos problemas reales del hito 1: una imagen grande se pixela al acercar, y ampliar o corregir la imagen desplaza todos los lugares ya colocados. La propuesta: **dibujar el mapa como datos**, no como imagen, y dejar que el programa rellene con casas, árboles, calles y muros.

**Principios**
- **Coordenadas en metros del mundo**, no normalizadas sobre una imagen. La escala deja de calibrarse (1 unidad = 1 metro), el lienzo **no tiene límite** y crece solo; ampliarlo no mueve nada de lo ya hecho. La imagen pasa a ser una **capa opcional de calco** (posición, escala y opacidad propias), útil para trazar encima de un boceto o usar arte propio en una zona.
- **Se dibujan formas, no edificios.** El autor traza polígonos (agua, bosque, parque, distritos), líneas (ríos, calles, muros, caminos) y puntos (lugares). Los edificios, los árboles y las manzanas los **genera un algoritmo con semilla** a partir de la forma y unos pocos parámetros; no se guardan, se recalculan igual cada vez. Modificar o borrar una zona no obliga a redibujar nada más.
- **Todo es JSON** consultable (por el motor, por el modelo y por mí): distritos, lugares, calles, adyacencias y distancias se pueden leer sin interpretar una imagen.

**Capas (cada elemento con id, estilo y nivel de zoom mínimo)**: terreno (agua, tierra, bosque, campo, parque, montaña) · líneas (río, calle principal, calle menor, camino, muralla con torres, puente) · distritos con su receta de relleno · lugares y enlaces (como ahora) · etiquetas (nombres sobre áreas o a lo largo de una línea) · símbolos sueltos (torre, faro, puerto) · capa de calco opcional.

**Generadores de relleno de un distrito** (parámetros: patrón, tamaño de manzana, densidad, rotación, anchura de calle, semilla):
- *Cuadrícula:* manzanas orientadas y recortadas al polígono, subdivididas en parcelas y casas rectangulares.
- *Radial* (como la Ciudad Imperial): anillos y radios alrededor de un centro, con manzanas en cuña.
- *Orgánico* (como Pentguard): celdas de Voronoi reducidas hacia dentro para dejar calles, con casas dispersas.
- Árboles por dispersión en bosques y parques, muralla con torres a intervalos, puentes donde una calle cruza un río, y las calles dibujadas «cortan» las casas.
- **Asistentes de ciudad** (radial, costera, pueblo, aldea): crean de una vez distritos, calles, muralla y plazas como formas **normales y editables**; no son cajas negras.

**Herramientas nuevas del editor**: polígono de terreno con suavizado de bordes · línea con anchura y tipo · receta de relleno por distrito con vista previa en vivo y botón de «otra semilla» · congelar los edificios de un distrito si se quiere fijarlos · calco de imagen · ajuste a vértices y extremos · copiar y pegar · importar y exportar GeoJSON (permite empezar desde el generador de ciudades de Watabou o desde QGIS/OpenStreetMap; hay que comprobar sus condiciones de uso).

**Dibujo y rendimiento**: el mapa se pinta en **canvas 2D** con las mismas rutinas en el editor y en el juego; solo se dibuja lo visible; a zoom lejano se omiten casas y árboles (cada elemento declara desde qué zoom aparece); lo ya pintado se guarda en teselas para que desplazarse sea fluido en un móvil. Los asas de selección se siguen pintando en una capa SVG encima. El estilo (paleta, grosor de líneas, textura de papel, ligera irregularidad dibujada a mano) es **datos**, así que se cambia sin tocar los mapas.

**Qué recibe el motor**: solo geometría simple (lugares en metros, polígonos de distrito, enlaces) y, más adelante, las calles como grafo si algún día se quiere calcular rutas por calles. La estética no afecta a las reglas. Además, el motor puede describir el mapa en texto para el GM: qué distrito limita con cuál, qué lugar está al norte de otro, qué hay a menos de X metros.

**Límites y riesgos**
- No iguala la pintura a mano de las referencias: es un estilo plano e ilustrado. Si se quiere arte pintado en una zona, entra como capa de imagen anclada a metros.
- Es bastante más trabajo que el hito 1: el visor y el editor pasan de imagen+SVG a canvas con capas, y hace falta la parte de generadores. Se mitiga con el orden de hitos.
- Rendimiento de una ciudad densa en móvil: se prueba pronto en Android con una ciudad de miles de edificios.
- Los edificios generados cambian si se mueve el contorno de su distrito; los lugares no (su posición es la que manda) y reservan su parcela.
- Sin interiores, sin geometría realista, sin edición casa por casa (solo exclusiones y fijados).

**Orden propuesto** (el hito 1 actual se aprovecha: validación, almacén, rutas de desarrollo, tests de geometría y buena parte de la interfaz)
1. **Esquema v2 y lienzo vectorial:** coordenadas en metros, lienzo ilimitado, capa de calco opcional, render en canvas; formas básicas (terreno, líneas, distritos) y lugares.
2. **Generadores y asistentes** (cuadrícula, radial, orgánico, árboles, muralla, puentes) con semilla.
3. **Pulido visual:** etiquetas sobre líneas, temas, textura de papel, niveles de zoom y teselas.
4. **GeoJSON** (importar y exportar) y descripción en texto del mapa para el GM.
5. Continuar con el hito 2 del motor (tiempos por distancia en metros, que se simplifica porque ya no hay escala que calibrar).

**El «mapa provisional»**: con esto el boceto *es* el mapa. Se modela la ciudad principal con unas cuantas formas y los lugares, y se va ampliando sin tirar nada.

## 8. Mapas regionales y atlas (hecho el 2026-10-05)

Se extendió el editor existente (no hay un editor aparte) para construir mapas de **cientos de kilómetros** con los mismos datos y herramientas, y se construyó con él el primer mapa regional: **`northfortress_territory`** (el mapa de la ciudad `northfortress` sigue siendo el del juego). Detalle de uso en [README.md](README.md) («Mapas regionales y el atlas de Northfortress»).

**Arquitectura.** Capas de datos en `src/shared/` (sirven al navegador y a Node): `mapDefaults.js` (tipos de lugar, iconos, importancia, decoración), `mapTerrain.js` (terreno con nieve, desierto, zona árida, urbano e industrial; celda configurable de 4 m a 5 km; `paintPolygon`; dispersión por trozos de copas, cumbres y edificios), `mapTravel.js` (**distancias y tiempos**: `linkKm`, `linkMinutes`, `planTrip` con transbordos, formato de duraciones), `mapLayers.js` (13 capas) y `mapSchema.js` (normalización y validación de lo nuevo). Pintores en el cliente: `maprender.js` (terreno y escena) y `mapatlas.js` (símbolos de ciudades, conexiones por modo, regiones, decoración, **composición de etiquetas sin solapes**), usados tanto por la vista final del editor como por el mapa del juego.

**Decisiones.**
- **Escala:** 1 unidad = 1 m también a escala regional (el dibujo es la distancia real); una conexión puede guardar además una distancia diegética (`distanceKm`) distinta de la dibujada. Los tiempos salen de la distancia y de la velocidad del modo (por mapa) o se escriben a mano.
- **Capas:** solo del editor (visibilidad y bloqueo), no se guardan; la capa de cada elemento se deduce de su tipo.
- **No se tocó el viaje del juego:** `geography.js` y `world.json` siguen igual (80 m/min dentro de la ciudad). El atlas es de **solo lectura** (`/api/atlas…`) y es la base para el viaje entre ciudades.

**Pendiente / preparado para conectar.**
1. **Viaje entre ciudades en el juego:** enlazar `place.data.detail_map` / `detail_place` (la capital apunta a la ciudad `northfortress`, Porta Magna a su estación) con `geography.js`, aplicar `planTrip` en la herramienta `travel` y definir tope a pie, taxi y costos (§6).
2. Lugares y conocimiento del atlas (niebla por distrito, `discovery`) en el cliente del juego.
3. Exportar el atlas a teselas horneadas (el estilo «Atlas oscuro» ya es un tema con postproceso) y horneado de grupos.
4. Pendientes del terreno: que pertenezca a grupos/bloqueos y caminos que sigan la orilla.
5. Nombres provisionales «(prov.)» y la geografía menor del territorio por validar con el autor; las distancias de las cinco ciudades siguen el lore (Heartstone ≈ 20 km, Market Bridge 35–50, High Sanctuary 60–90, Westwall 100–150).
