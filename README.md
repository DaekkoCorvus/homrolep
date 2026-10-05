# Heroes of Misery RPG

Prototipo mobile-first de un simulador social y RPG narrativo ambientado en el universo de Heroes of Misery. Esta primera versión ofrece un pequeño mundo funcional; no pretende implementar todavía el lore, combate ni dirección narrativa con IA completos.

La dirección del proyecto, las decisiones tomadas en «HOM ROLEPLAY» y lo que sigue pendiente están en [la visión del simulador](HOM_SIMULATOR_VISION.md). Ese documento guía las siguientes implementaciones y sustituye como referencia de diseño al plan inicial de bootstrap. El diseño de jugabilidad (impresiones de NPC, chat y citas, relojes de tensión) está en [GAMEPLAY_DESIGN.md](GAMEPLAY_DESIGN.md).

## Estado

**Prototype / MVP.** Incluye creación de personaje por escenas, prólogo y narración de acciones con NanoGPT, llegada a Porta Magna, persistencia de Runs, reloj de mundo, Event Log semántico, feed social y un shell PWA adaptable a teléfonos.

El prototipo jugable está en la rama `dev`. La rama `main` conserva el bootstrap hasta que se revise y fusione el PR.

## Requisitos

- Node.js 20 o posterior
- npm

No usa dependencias de producción ni módulos nativos.

## Instalación

```bash
git clone https://github.com/DaekkoCorvus/homrolep.git
cd homrolep
git switch dev
npm install
npm start
```

Abre `http://localhost:3000`. El servidor escucha solo en `127.0.0.1`, incluso en Termux, para que los ajustes de IA y las partidas no queden expuestos a otros dispositivos de la red. Puedes cambiar el puerto con la variable `PORT`.

Para desarrollo con recarga automática del servidor:

```bash
npm run dev
```

**Pruebas locales en Windows:** doble clic en `iniciar-local.bat` (o `node scripts/dev-local.mjs`). Arranca el servidor, abre el navegador y guarda un log temporal en `.local/logs/latest.log` (la ejecución anterior queda en `previous.log`; la carpeta está en `.gitignore`). El log incluye versión, rama, estado de la conexión de IA (sin la key), peticiones `/api` con su código y duración, y los errores del servidor. Opciones: `--no-open` (no abrir navegador), `--watch` (reiniciar al cambiar el código) y `--test` (ejecutar `npm test` antes de arrancar). Si el puerto 3000 está ocupado usa el siguiente libre.

## Termux

```bash
pkg update
pkg install git nodejs
git clone https://github.com/DaekkoCorvus/homrolep.git
cd homrolep
git switch dev
npm install
npm start
```

Después, abre `http://localhost:3000` en el navegador Android.

## Rendimiento y cancelación

Las llamadas a NanoGPT no tienen límite de tiempo propio (algunos modelos tardan más de 10 s en el primer token). Mientras se genera una respuesta, el botón de enviar se convierte en **detener**: cancela la llamada en el servidor y la partida no cambia. La escena animada se congela durante las conversaciones y, en equipos lentos, automáticamente; `/fx lite` (estática), `/fx full` o `/fx auto` lo fuerzan a mano.

## Herramientas de desarrollo

Escribe `/dev` en el campo de acción libre para activarlas (o abre `/?dev=1`). Incluyen reiniciar y regenerar respuestas, cambiar la hora, teletransportarse y un editor de fichas de NPC con importar/exportar. Detalles en [GAMEPLAY_DESIGN.md](GAMEPLAY_DESIGN.md). Solo funcionan con esa cabecera local; no forman parte de la experiencia de juego.

**Editor de prompts:** `/prompts` abre cuatro prompts (Personaje, Texto, GM, Social) hechos de módulos ordenables, con vista previa, último enviado e importación de presets de SillyTavern. Los cambios se guardan en `data/prompts/`.

**NorthLife:** red social del juego (feed tipo línea de tiempo con cuentas inventadas y canon, likes, hilos y avisos). El prompt Social genera varias publicaciones con su hora de publicación; el motor las valida y las muestra cuando llega esa hora. `/feed` genera publicaciones al momento.

**Avatares de NorthLife:** añade URLs https directas a `data/canon/social/avatars.json` (`{"avatars": ["https://…"]}`); el servidor las asigna a las cuentas aleatorias que registre y las relee solo. Las cuentas canónicas usan imágenes locales de `assets/social/accounts/` (configuradas en `data/canon/social/accounts.json`).

**Partidas guardadas:** «Partidas» en el inicio y en Ajustes permite tener varias partidas, renombrarlas, duplicarlas y eliminarlas.

## Pruebas

```bash
npm test
```

## Configuración y seguridad

En la pantalla inicial, abre **Ajustes**, pega tu API key de NanoGPT y elige un GM: **Spark 1.3** (interpretativo y estricto), **DeepSeek** (creativo y más suave) u **Otro modelo** (escribe cualquier identificador de NanoGPT, o pulsa «Ver modelos de NanoGPT» para listarlos). **Guardar** es instantáneo y no llama al modelo, así que puedes cambiar de uno a otro para comparar respuestas; **Probar conexión** es opcional y hace una llamada corta. Las frases de la entidad y las narraciones pueden consumir saldo o cuota de NanoGPT. No envíes tu key por chat ni la introduzcas en archivos del repositorio.

La key se guarda en `.local/ai.json` en el servidor local, fuera de Git y de las partidas; el navegador nunca la guarda en localStorage ni la recibe de vuelta por la API. **Olvidar API key** la elimina. Este prototipo es para uso local de una persona; mantén protegidos el dispositivo y esa carpeta. La historia inicial, el personaje, las acciones y hasta 12 eventos recientes se envían a NanoGPT. Las frases breves y personalizadas de la entidad usan `deepseek/deepseek-v4.1-flash`; el GM que elijas narra la llegada a la estación y las acciones. Si NanoGPT falla al crear la partida o narrar una acción, no se guarda ningún avance; las frases de la entidad tienen un texto de respaldo. Las partidas existentes se pueden leer sin conexión configurada.

### Medir y comparar modelos

En modo desarrollador (`/dev`): **Sonda de modelos** (`/sonda [modelo …]`) prueba con uno o varios modelos texto plano, el protocolo JSON de reserva, herramientas nativas (`tools`, también varias a la vez y la segunda vuelta con el resultado) y salida con esquema, y muestra tiempos y tokens; **Estadísticas de llamadas** (`/stats`) da la media de segundos y tokens por tipo de llamada (`gm:action`, `character:reply`…), y «Último enviado» del editor de prompts muestra modelo, tiempo, tokens e intentos de cada llamada. Lo mismo desde la consola, con la key de Ajustes:

```bash
npm run probe                                   # el modelo guardado en Ajustes
npm run probe -- modelo1 modelo2                # compara hasta 4 modelos
npm run probe -- --json --tests tools,multi …   # salida JSON / solo algunas pruebas
```

### Herramientas del motor (Fase 1 del rediseño)

Los verbos del juego viven en un **registro de herramientas** (`src/server/ai/tools/`), descrito en [AI_ENGINE_REDESIGN.md](AI_ENGINE_REDESIGN.md):

- `registry.js`: contrato de cada herramienta (nombre, parámetros en JSON Schema, roles, `query`/`action`) y ejecutor que valida los argumentos antes de llamar al handler. Un rechazo (`{ ok: false, reason, hint }`) es información para el modelo, no un error.
- `game.js`: handlers deterministas de `travel`, `wait`, `sleep`, `work`, `start_conversation` y `share_contact`. Los botones de la interfaz (`applyAction`, abrir una conversación) y el modelo pasan por los mismos handlers, así que el juego sigue funcionando sin IA y no pueden divergir.
- `loop.js` (expuesto como `ai.chatWithTools`): bucle de hasta 3 pasos; el último va sin herramientas para que el modelo narre. Transporte nativo (`tools`/`tool_calls`) o codec JSON de reserva (`{"say", "calls"}`) para modelos sin `tools`; en modo `auto` se prueba el nativo y se recuerda por modelo si el proveedor lo rechaza. Cada llamada queda en la traza (`tools:<rol>`).

Las acciones con botones siguen sin llamar al bucle; la acción libre lo usa desde la Fase 2.

### Mundo libre con herramientas (Fase 2 del rediseño)

La acción libre que escribe el jugador ya no pasa por un JSON con `talkTo`: el GM recibe una **cabecera ambiente** y actúa con las herramientas del motor (`ai.act` → `chatWithTools`).

- **Cabecera ambiente** (`src/server/ai/ambient.js`): texto compacto que calcula el motor (día y hora, lugar con horario, quién está aquí con su id, pendientes y mapa de viaje). Cubre casi todas las consultas; es un módulo obligatorio del prompt GM.
- **Herramientas del GM:** `travel`, `wait`, `sleep`, `work`, `spend_time` (el motor fija los minutos por tabla de actividades; el modelo solo sugiere), `start_conversation` (absorbe a `talkTo`), consultas (`who_is_here`, `place_info`, `recent_events`, `player_status`) y **`attempt`**.
- **`attempt` / `no_mechanic`:** para comprar, usar objetos, pelear, robar, convencer… el modelo narra solo el *intento*; el motor no cambia dinero, objetos ni relaciones y anota la intención en `run.intents` (hasta 100 por partida). En modo desarrollador, `/intenciones` o «Intenciones sin mecánica» en el panel las cuentan por tipo: es la lista de mecánicas que conviene construir primero.
- Los rechazos del motor vuelven al modelo como «sí, pero…». Si la IA falla o no narra, la partida no cambia. El modo de prompt `narration` pasó a `free` («Mundo libre (con herramientas)» en el editor, con vista previa que usa la cabecera real de la partida abierta).

**Protocolo por modelo:** cada modelo habla con las herramientas de una forma. Por defecto, DeepSeek usa las `tools` nativas y Muse Spark el codec JSON de reserva (el catálogo del proveedor anuncia tools, pero en la práctica solo responde bien al JSON); cualquier otro modelo prueba nativo y recuerda si lo rechaza. En modo desarrollador, `/herramientas auto|nativo|json` cambia el del modelo guardado y la sonda ofrece «Usar este protocolo». Se guarda en `.local/ai.json`. Si un modelo reciente falla, el error de Ajustes y de las partidas incluye ahora el «Motivo del proveedor», y un rechazo del tope de tokens se reintenta una vez con 8192. NanoGPT tiene dos hosts con la misma API pero catálogos que pueden diferir mientras despliega modelos nuevos (`api.nano-gpt.com`, el directo, y `nano-gpt.com`, el del sitio): el motor usa el directo, prueba el otro si dice «Model X is not supported on /v1/chat/completions» y recuerda cuál funciona; la lista de modelos de Ajustes une los dos catálogos. Solo se admiten esos dos hosts, la API key no viaja a ningún otro.

### Personaje con herramientas y trabajo en segundo plano (Fase 3 del rediseño)

El personaje (en persona y en chat) ya no rellena un formulario JSON: **responde con texto** (marcas `{emoción}` y, si quiere, una acción *entre asteriscos* al principio, que pasa a ser su gesto) y declara efectos con herramientas en la **misma** llamada (`src/server/ai/tools/character.js`):

- `agree_plan` (acepta explícitamente un plan; exige la cita literal del jugador), `remember` (nombre o dato que el jugador dijo; con cita), `note_to_self` (nota privada para su siguiente turno), `share_contact` (con las condiciones de su ficha) y `end_conversation` (se despide él mismo). En chat solo tiene `agree_plan` y `remember`. Nunca ve herramientas del mundo (viajar, dinero…).
- Las herramientas solo **recogen** lo que declara; el motor lo valida después contra lo dicho de verdad (citas literales, condiciones de la ficha, lugares que existen) y descarta lo que no tiene respaldo. Un mismo acuerdo dicho por el personaje y repetido por el GM al cerrar no se duplica (mismo tipo, lugar y hora).
- Se acabaron la regex `AGREEMENT_HINT`, el lote de chats del GM (`gm:chats`, el más lento de las estadísticas) y el modo `chats` del prompt GM.

**Cierre en segundo plano.** Al despedirse (o cuando el personaje termina la conversación) el jugador solo espera la despedida. La reflexión del GM (impresiones con valencia, resumen y lo que el personaje no anotó) queda como `pendingEvaluation` en la partida y corre en segundo plano; se aplica antes de que ese personaje vuelva a hablar (abrir otra conversación o escribirle espera a que termine) y se reanuda si se reinicia el servidor. Si falla, se reintenta al consultar la partida (3 intentos; luego se descarta con un `evaluation_failed` en el registro). La generación del feed de NorthLife también corre en segundo plano: la acción responde de inmediato y las publicaciones llegan después (la pantalla consulta cada 5 s mientras haya algo pendiente). Detalle técnico: el trabajo de fondo hace su llamada al modelo sin tener la partida y solo toma el bloqueo para cargar, aplicar y guardar, así que nunca pisa lo que el jugador hizo mientras tanto.

**NorthLife en segundo plano (Fase 1b, cerrada).** Publicar o responder se guarda al instante: la petición ya no espera al modelo. La reacción de la red (respuestas, likes, reposts) queda como `pendingReactions` en la partida, se genera después con la misma validación de siempre y se aplica sin pisar lo que el jugador haya hecho mientras tanto. Si falla, se reintenta al consultar la partida (3 intentos; luego la publicación se queda sin reacciones) y sobrevive a un reinicio del servidor. Si hace más de 2 h de juego que no se genera el feed, publicar también lo renueva, en segundo plano. En la pantalla, la publicación muestra «La red está reaccionando…» (tres puntos animados; sin animación si el sistema pide movimiento reducido) y, cuando llegan las respuestas, aparece el aviso «NorthLife: tienes novedades» con la insignia roja de siempre y una vibración corta en el móvil.

### Broker de contexto (Fase 4 del rediseño)

Qué se envía en cada llamada lo decide el motor, no se vuelca todo (`src/server/ai/context/`):

- **Ficha en dos capas** (`card.js`). Siempre va la capa básica (nombre, rol, resumen, personalidad y voz). Trasfondo, apariencia, conocimientos, secretos, conexiones y gustos de ropa se trocean en entradas cortas y **solo entran las que vienen al caso**, elegidas por palabras clave de lo que se está hablando (raíces de 5 letras: tolera plurales, acentos y conjugaciones; hasta 4 entradas y ~1.100 caracteres por turno). Un trasfondo de 150.000 caracteres cuesta lo mismo por turno que uno vacío. Si el motor no adelantó algo, el personaje puede pedirlo con la herramienta `recall` (cuesta una vuelta extra solo cuando la usa). Es también la base del lorebook.
- **Ventana de conversación** (`history.js`): al personaje se le reenvían las últimas 16 intervenciones en persona (12 en chat) con una nota de cuántas se omiten; lo importante ya quedó en recuerdos, datos y pendientes (Fase 3). La reflexión del GM sí recibe la transcripción completa porque necesita las citas literales.
- **Escena en una línea de texto** («Ahora: día 1 (lunes), 09:00. Lugar: …») en vez de JSON con claves largas.
- **Avisos motor → modelo** (`notices.js`): el GM del mundo libre recibe, en su cabecera, «Desde tu última intervención» con líneas cortas de lo ocurrido desde su última llamada (viajes, conversaciones, acuerdos cumplidos o incumplidos, tiempo que pasó…) y la última narración para continuar la historia; ya no se envía el registro de sucesos en bruto con las narraciones enteras. La narración de los botones usa la misma lista corta con nombres. NorthLife recibe `avisos` (hace cuánto se generó la última tanda, cómo les fue a las publicaciones del jugador, a quién agregó) y de sus contactos solo rasgos y forma de hablar.
- **Instrucciones y herramientas más cortas**: las reglas del motor del personaje se fusionaron, el formato de salida ya no repite lo que dice cada herramienta, y el GM pierde `recent_events` y `player_status` (la cabecera y los avisos ya lo dicen). En una ficha corta, cada llamada baja entre un 20 % y un 27 % (p. ej. turno de personaje ~3.500 → ~2.800 tokens contando las herramientas; mundo libre ~2.900 → ~2.250). La ganancia crece con fichas largas y conversaciones largas.

### Chat en ráfagas (NorthLife → Chats)

El chat con un contacto funciona como mensajería, con **una sola llamada al modelo por intercambio**:

- **Tú mandas los mensajes que quieras.** Cada envío se guarda al instante (✓), sin esperar al modelo y sin gastar tiempo de juego. Con texto en la caja, el botón envía; con la caja vacía y mensajes sin responder, **el mismo botón cambia de icono y pasa el turno**. Mientras responden, ese botón es «detener» (y durante la reproducción, muestra la respuesta de golpe). En ordenador, Enter envía un mensaje (Mayús+Enter salta de línea); en móvil, Enter es salto de línea.
- **El personaje responde con uno o varios mensajes** (una línea = un mensaje, hasta 4; lo que sobre se une al último). Puede pedir ritmo con `{pausa}` o `{rapido}` al principio de una línea, pero **el tiempo lo fija el motor**: lo que «escribe» cada mensaje es proporcional a su largo (0,8–3,6 s, con tope de 5 s si pide ir más despacio) y lo que tarda en «ver» el chat depende de su horario (más ocupado o de madrugada, más lento; con confianza, menos; tope 6 s). Pasar el turno cuesta 1 minuto de juego, no uno por mensaje.
- **La animación tapa la espera del modelo:** al pasar el turno, ✓ → ✓✓ «Visto» (tiempo propio del contacto) → «escribiendo…» mientras el modelo piensa → sus mensajes van apareciendo uno a uno, cada uno tras su «escribiendo…». Lo ya escrito mientras el modelo pensaba cuenta. Con «reducir movimiento» activado, todo va ~3 veces más rápido.
- **Respuestas directas, en los dos sentidos:** toca un mensaje y pulsa ↩, o arrástralo hacia la derecha, para responder a ese mensaje concreto. El personaje también puede: cada mensaje de la conversación lleva un número `n` y empieza una línea con `{re:N}` para responder a uno suyo o tuyo (un número que no existe se ignora). Las citas guardan y muestran **solo el principio del mensaje** (100 caracteres, en una sola línea, 2 líneas como máximo en pantalla): el texto entero nunca se pinta en la barra de respuesta ni en la burbuja, así que un mensaje larguísimo no puede ensanchar ni romper la pantalla del móvil.
- `POST /api/runs/:id/chat` admite `{ op: "send", npcId, text, replyTo? }` (guarda, sin modelo), `{ op: "turn", npcId }` (el personaje responde) y, sin `op`, el formato antiguo `{ npcId, text }` (las dos cosas). Los acuerdos y datos que el personaje anota con sus herramientas se validan contra **todos** los mensajes del lote.

### Editor de mapas (modo desarrollo, solo PC)

Parte del motor, no una herramienta aparte: se abre en `http://localhost:3000/mapeditor.html` (también con `/mapa` en el chat de desarrollo o desde el panel de desarrollo → «Mapas»). El plan completo está en [MAP_SYSTEM_PLAN.md](MAP_SYSTEM_PLAN.md); esto es el **hito 1, esquema v2**. El mapa que designa `data/canon/world.json` ya es el mapa del juego (ver «El mapa en el juego» más abajo): lo que guardes aquí lo usa el simulador sin reiniciar.

- **El mapa es un conjunto de datos en metros, no una imagen.** Lienzo plano e infinito (x hacia el este, y hacia el sur; se puede ampliar en cualquier dirección sin perder lo editado). Se dibuja con: **áreas** (agua, tierra, bosque, zona urbana… con una *receta de relleno* orgánica, cuadrícula, radial o de árboles, con semilla), **caminos** (avenidas, calles, senderos, ríos, murallas, vías, puentes; tienen prioridad y parten el relleno), **distritos** de juego (niebla, lugares del jugador), **lugares** (id, nombre, alias, tipo, acceso, horario, huella de edificio opcional, requisitos…) y **enlaces** (trayectos escritos a mano, como el metro de Porta Magna). Las casas y los árboles **no se guardan**: los genera `src/shared/mapGen.js`, un algoritmo determinista con semilla, a partir de la receta del área (el editor los muestra en vivo con la casilla «Relleno»). Medidas por defecto realistas: manzanas de 60–140 m, casas de ~12×16 m, calles de 8–12 m.
- **Terreno natural con pinceles:** el fondo del mapa (mar, tierra, arena, campo, bosque, parque, montaña) se **pinta** con la herramienta «Pincel» (B), no con polígonos: pintar, borrar, suavizar y bote, radio de 8 m a 3 km (`[` y `]`), borde irregular, opción de no pisar el agua y Alt para borrar. Es una rejilla de celdas de 16 m guardada por trozos comprimidos (`terrain` en el mapa; `src/shared/mapTerrain.js`) y se dibuja con **bordes naturales** (contornos suavizados y deformados con ruido, sin cuadrícula a ningún zoom). La pestaña «Terreno» **genera terreno natural** (mar, costas con arena, tierra, campos, bosques y montañas, con semilla y deslizadores; se puede deshacer) y ajusta los bosques. Los **bosques son tupidos**: copas de 2–4 m que se solapan, con borde oscuro y brillo, repartidas por trozos con semilla (al alejar el zoom se agrupan en copas más grandes); las montañas se dibujan como cumbres sombreadas. Los **polígonos** se reservan para las zonas urbanas (y siguen valiendo los de agua/bosque de antes).
- **Relleno generado:** `orgánico` (Voronoi reducido hacia dentro: manzanas irregulares y calles que serpentean), `cuadrícula` (rotable, tamaños variables), `radial` (anillos y radios) y `árboles` (dispersión de Poisson). Las manzanas se llenan de parcelas pegadas a la calle en dos filas con patio interior; la misma semilla da siempre la misma ciudad y «🎲 Nueva» da otra. **Los caminos mandan** (ninguna casa invade su calzada, por estrecha que sea), **los lugares reservan su parcela** (con huella o con un radio de 2 m) y el agua, las plazas, los parques, las montañas y los bosques no se edifican. Una ciudad de 5 km² se genera en ~0,2 s. **Un camino funciona como un cuchillo:** corta las manzanas por su calzada (operaciones booleanas de polígonos con la biblioteca empaquetada `src/shared/polygonClipping.js`, MIT), así que las parcelas nuevas se alinean con el borde del camino y las casas miran a él; un camino que termina dentro de una manzana deja un callejón sin salida.
- **Grupos con bloqueo:** todo se organiza en grupos (una ciudad, una facción…, anidables). Lo que dibujes se añade al «grupo activo». Un grupo **bloqueado** —y todo lo que contiene— no recibe cambios (el editor lo congela y avisa). Más adelante un grupo terminado podrá «hornearse» para no recalcularse.
- **Imágenes de calco (opcionales):** se puede subir una o varias imágenes (se convierten a WebP si quieres) para calcar encima, calibrarlas con la herramienta «Escala» y quitarlas cuando ya no hagan falta. No forman parte del mapa final.
- **Estilos y shader (vista final):** la casilla «Vista final» de la barra inferior pinta el mapa completo con el estilo elegido (Pergamino, Plano limpio, Noche, Acuarela; `style.theme`, datos en `src/shared/mapStyle.js`) y le pasa un **shader WebGL** de postproceso (grano de papel, manchas, viñeta, saturación, contraste, calidez, tinta en los bordes) que se afina con deslizadores en la pestaña «Mapa» (`style.post`, se guarda con el mapa). Es solo lectura. Es el mismo pintor (`src/client/maprender.js`) que usará el exportador para hornear teselas, así que lo que ves es lo que se exportará; el juego no calculará shaders en tiempo real. Sin WebGL se ve igual pero sin postproceso.
- **Selección múltiple:** herramienta «Selección» (S): arrastra un rectángulo —de izquierda a derecha elige lo que queda **entero** dentro, de derecha a izquierda lo que **toca**—; Ctrl o Mayús + clic (en el mapa o en las listas) suman o quitan; Ctrl+A selecciona todo. Con varios elementos elegidos, el panel derecho permite **moverlos a un grupo de una vez**, crear un grupo nuevo con ellos (Ctrl+G) o borrarlos; lo bloqueado se omite y un grupo bloqueado no recibe nada. Mientras dibujas (área, camino, distrito) el **clic derecho quita el último punto**.
- **Herramientas:** mover, selección, lugar, área, camino, distrito, medir (metros y minutos a pie y en taxi, velocidades provisionales) y escala; imán a los vértices existentes (Alt lo desactiva), cuadrícula con barra de escala, previsualización de niebla, deshacer/rehacer y validación en vivo. Atajos: V mover, S selección, P lugar, A área, W camino, D distrito, M medir, E escala, Ctrl+S guardar, Supr borrar, Intro cerrar, Esc cancelar.
- **Ids:** texto legible en minúsculas con guiones bajos (`luna_cafe`), generados a partir del nombre mientras lo escribes. Los de lugares y enlaces son **únicos en todo el juego** (el editor y el servidor comparan con los demás mapas). Renombrar o borrar un lugar que usa la ficha de un NPC avisa antes. El distrito de cada lugar lo calcula el motor a partir de los polígonos.
- **Dónde guarda:** `data/canon/maps/<id>.json` (JSON ordenado, un archivo por mapa) y las imágenes de calco en `assets/maps/`. Antes de sobrescribir deja una copia con fecha en `data/canon/maps/.backup/` (se conservan las últimas 20; no se sube a git). Un mapa con errores no se guarda. Los mapas del esquema anterior (sobre una imagen) se convierten solos a metros al abrirlos.
- **Una sola validación:** el editor y el servidor usan los mismos módulos (`src/shared/geo.js`, `mapSchema.js` y `mapDefaults.js` y `mapGen.js`, que se sirven al navegador tal cual), así que lo que el editor da por bueno es lo que el motor acepta. Los errores impiden guardar (ids duplicados, polígonos cruzados o casi vacíos, caminos sin longitud, recetas de relleno absurdas, grupos con ciclos, enlaces rotos…); los avisos no (medidas raras pero posibles, lugar fuera de todo distrito, distritos solapados, grupos vacíos, referencias de NPC a lugares que ningún mapa define).
- **Seguridad:** las rutas `/api/dev/maps` exigen la cabecera de desarrollo y solo existen en localhost; solo se aceptan PNG, WebP y JPG (nada de SVG) de hasta 24 MB, cuyo tamaño se lee de la cabecera real del archivo.
- **`MapView`** (`src/client/mapview.js`) es el visor reutilizable (paneo, zoom, conversión pantalla ↔ metros, capas): lo usan el editor y el mapa del juego. Con pantalla táctil, **pellizcar** con dos dedos hace zoom y mueve el mapa (también en el editor); con `drag: true` (el juego) un dedo arrastra, un toque corto emite `tap` y `doubleTapZoom: true` acerca con doble toque.

### El mapa en el juego (etapa 1 del rediseño de la interfaz)

El mapa del editor **es** el mapa del simulador (plan en [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) §5 y en [MAP_SYSTEM_PLAN.md](MAP_SYSTEM_PLAN.md)). Nada de lugares, ids ni coordenadas vive en el código:

- **`data/canon/world.json`** designa el mapa del juego (`mapId`), el lugar de inicio (`spawn`, hoy `station`) y los ajustes de viaje: `walkMetersPerMinute` (80), `minTravelMinutes` (2) y `maxWalkMinutes` (180, tope de un tramo a pie). Sustituye a `data/canon/locations/porta_magna.json`, que ya no existe. El id interno `cityId: "porta_magna"` de los guardados se mantiene por compatibilidad.
- **Ids unificados con los del motor** (`cafe`, `station`, `apartment`, `park`, `store`): el JSON del mapa usa esos ids, así que no hubo que migrar guardados ni fichas de NPC. **El jugador ve siempre el `name` del editor** (p. ej. «Tienda "MiniMarket"») y el distrito del mapa; los horarios (`hours`), descripciones y tipos (`kind`) de los cinco lugares se copiaron al mapa.
- **`src/server/game/geography.js` es la fuente única** de lugares, distancias y tiempos. `geography.world()` da `{ id, name, locations[], spawn }` (compatible con lo que ya usaba el motor) más `trip(desde, hasta)` → `{ minutes, meters, tooFar }`: minutos = `max(minTravelMinutes, round(metros / walkMetersPerMinute))`, **relativos al origen** (café → estación 23 min, apartamento → tienda 3 min). Lo calcula el motor (`travel`, `place_info` y la cabecera ambiente «minutos a pie desde aquí»); la IA solo narra.
- **Recarga en caliente:** el servidor relee el mapa si cambia el archivo (y al instante cuando el editor guarda). Un mapa inválido nunca rompe el juego: se usa la última copia buena de `data/canon/maps/.backup/` o se conserva el que estaba cargado, y se avisa por consola. Una partida guardada en un lugar que el mapa ya no tiene vuelve al lugar de inicio y deja una nota en el Diario; un lugar sin escena propia usa la escena genérica de su `kind`.
- **Mapa jugable** (`src/client/worldmap.js`): lo abren el verbo **Ir** y la app Mapa del teléfono. Pinta el mapa con el estilo nocturno del editor (siempre, sin depender de la hora), con pellizco, arrastre con un dedo y doble toque; los lugares se tocan en un radio de 26 px, los nombres que se pisarían se ocultan y el de donde estás siempre se ve. La **hoja del lugar** muestra nombre, distrito, abierto/cerrado, distancia, minutos a pie y **hora de llegada**; **Ir** inicia el viaje: el marcador recorre el trayecto mientras avanza el reloj, la petición `travel` sale al empezar y, **si el servidor falla, el marcador vuelve al origen y se muestra el error** (la partida no avanza). Hay **vista de lista** (misma información), botón «Centrar en mí», foco atrapado, Escape y el gesto «atrás» del sistema para cerrarlo. Con `prefers-reduced-motion` no hay recorrido, solo el fundido; con efectos «ligeros» o si un cuadro tarda demasiado se quita el postproceso WebGL.
- `GET /api/world` (lugares con los nombres del mapa, sin tiempos), `GET /api/world/map` (el mapa para dibujarlo, con su `version`) y `GET /api/runs/:id/map` (metros y minutos desde donde está el jugador y quién suele estar en cada lugar, solo de quienes ya conoce).

Viajar, esperar, dormir y trabajar con los botones siguen narrándose con el modo `action`, sin herramientas.

La creación pregunta edad, género, apariencia e historia personal opcional; el nombre se pide justo antes de cruzar. La apariencia se guarda como referencia para futuras interacciones con NPC, pero no aparece en la ficha ni se envía al GM durante el prólogo o narraciones generales. La raza humana se asigna automáticamente por ser la única disponible. El prólogo comienza en la estación de Porta Magna. Ocupación y aspiración quedan sin definir al inicio y se desarrollarán durante el juego. El atajo de trabajo solo funciona en partidas que ya tengan la ocupación `worker`.

## Arquitectura

```text
src/client/             interfaz web mobile-first
src/server/index.js     servidor HTTP y API local
src/server/game/        reglas deterministas y contratos futuros
src/server/saves/       persistencia JSON atómica
src/server/ai/          interfaz del proveedor de IA
assets/                 recursos visuales, incluido el vórtice liminal
data/canon/             datos base inmutables del universo (mundo, mapas, NPC, red social)
data/templates/         esquemas de contenido futuro
public/                 manifest y service worker
saves/                  estado de Runs (fuera de Git)
tests/                  pruebas de reglas de juego
```

`CANON` describe el estado base. Cada `RUN STATE` guarda únicamente los cambios de una partida. Una Run nunca modifica los archivos canon.

El código es autoridad para dinero, inventario, tiempo, estadísticas, acceso, ubicación válida y persistencia. La IA interpreta la creación y las acciones, pero aún no modifica ocupación, aspiración, misiones ni otros sistemas de juego: eso se desarrollará en futuras iteraciones.

## API local

- `GET /api/world` — el mundo: lugares con los nombres del mapa (sin tiempos de viaje)
- `GET /api/world/map` — el mapa del juego (solo lectura) y su versión
- `GET /api/runs/:id/map` — distancias y minutos a pie desde el lugar actual
- `POST /api/creation/whispers` — frases breves de la entidad durante la creación
- `GET /api/ai/settings` — estado de la conexión, sin devolver la key
- `POST /api/ai/models` — modelos disponibles en NanoGPT
- `POST /api/ai/settings` — probar y guardar key y modelo
- `DELETE /api/ai/settings` — eliminar la key local
- `GET /api/runs` — partidas guardadas
- `POST /api/runs` — crear partida
- `GET /api/runs/:id` — cargar partida
- `POST /api/runs/:id/action` — ejecutar acción
- `POST /api/runs/:id/posts` — publicar en el feed

## Filosofía futura del GM

El Director Narrativo observará un resumen compacto del Run State, propondrá oportunidades causales, adaptará historias al rol emergente del jugador e interpretará acciones sin alterar hechos duros. El jugador podrá ignorar un gancho y el mundo seguirá avanzando. Los límites de intervención sobre sucesos canónicos aún requieren definición; véase [la visión del simulador](HOM_SIMULATOR_VISION.md).

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
