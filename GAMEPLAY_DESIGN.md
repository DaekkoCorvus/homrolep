# Heroes of Misery — diseño de jugabilidad

Complementa a [la visión del simulador](HOM_SIMULATOR_VISION.md). Recoge las decisiones de diseño acordadas sobre libertad del jugador, mundo social, lore en segundo plano y citas. Es un documento de dirección: nada de lo descrito aquí está implementado todavía salvo lo indicado en «Estado».

Principio rector: **la libertad está en lo que el jugador dice y hace; las consecuencias duras las resuelve el motor.** La IA (el GM) interpreta, juzga y narra; nunca es autoridad sobre dinero, inventario, tiempo, estadísticas ni estado guardado.

## 1. Geografía de partida

- La partida comienza en **Porta Magna**: la ciudad nexo y principal conectora, con línea de metro hacia Northfortress. El punto de llegada es su estación (antes «Umbral de Hierro»).
- Nombres oficiales: **Northfortress**, **Hearthstone**, **Porta Magna**.
- La partida siempre comienza **antes** del ataque a Porta Magna. No se fija una fecha: cuándo ocurre lo decide el reloj de tensión (§4).

## 2. Acción libre: interpretar, validar, resolver, narrar

Cada mensaje libre del jugador sigue cuatro pasos:

1. **Intención.** La IA convierte el texto en una propuesta estructurada (qué, con quién, dónde, cuánto tiempo, con qué tono).
2. **Validación.** El motor comprueba presencia, acceso, horarios, dinero y tiempo. El azar usa semilla de la partida y es reproducible.
3. **Resultado.** El motor fija lo que ocurrió; la IA lo narra dentro de esos límites.
4. **Consecuencias acotadas.** La IA puede sugerir cambios (impresiones, conocimiento, relaciones); el motor los recorta con topes por interacción. Nunca concede dinero, objetos ni permisos.

Regla de respuesta: «sí, pero…» o «lo intentas y ocurre esto». Nunca «no puedes porque el canon lo prohíbe». Un intento imposible se narra sin efecto mecánico.

Si una llamada de IA falla, la Run no avanza ni se sobrescribe.

## 3. Mundo social

### 3.1 NPC y presencia
- NPC civiles originales de Porta Magna (unos 8–12 al inicio), cada uno con: hogar, trabajo, rutina por hora con variación, personalidad, gustos, límites y lo que sabe.
- Al llegar a un lugar, el jugador ve quién está ahí según la hora. Las rutinas se pueden aprender sin ser una tabla infalible.
- Los encuentros con personajes históricos son raros al inicio y aumentan con la exposición (§5).

### 3.2 Impresiones (sistema de relaciones)
No hay un medidor de afecto que se llene con acciones repetidas. Cada NPC guarda **anotaciones ocultas** sobre el jugador, escritas por el GM con sinceridad y según la personalidad del NPC.

- Tras un primer encuentro 1‑a‑1, y después de cada interacción significativa, el GM analiza la conversación y emite: notas en la voz del NPC («me incomoda que intente hacerse el gracioso»), valencia, causa concreta y, si procede, interés o química.
- Una NPC fría reacciona mal al coqueteo excesivo; otra puede disfrutarlo. La misma conducta rinde distinto según quien la reciba.
- **Anclaje a hechos:** cada nota debe citar lo que el jugador dijo o hizo. El motor rechaza notas sin evidencia en el registro de la escena.
- **Topes:** el cambio por interacción está limitado para evitar giros bruscos; las notas viejas pierden peso salvo que sean marcadas.
- El jugador **no ve** las notas. Las percibe por el trato: tono, disposición, si comparten contacto, si aceptan una invitación.
- Los valores derivados (apertura, confianza, interés) que usa el motor salen de las notas, no al revés.
- El ritmo de una relación es natural, sin flujo obligatorio: cada persona avanza según su carácter. Romance y citas pueden ocurrir; no hay pasos que deban cumplirse.
- Alcance inicial: solo escenas **1‑a‑1**. Las escenas con varios NPC activos se diseñan después.

### 3.3 Contacto y chat
- El jugador consigue el contacto de un NPC si la impresión y la motivación lo permiten: el GM propone ofrecerlo y el motor comprueba un umbral.
- Con el contacto se abre un **chat** en la app de mensajes del teléfono. No hay botón de «invitar a una cita».
- El NPC responde según su horario (trabajando, durmiendo, ocupado): las respuestas pueden tardar en tiempo de juego.

### 3.4 Quedadas y citas
- El jugador acuerda día, hora y lugar escribiendo en el chat. El GM extrae el acuerdo y el NPC lo **acepta, propone otra hora o lo rechaza** según su agenda y personalidad.
- Si se acepta, queda registrada una cita en el estado de la Run y aparece en la **agenda del teléfono** (como cualquier persona la anotaría). No hay teletransporte ni recordatorio mágico: el jugador debe **ir en persona**.
- El NPC espera **30 minutos de juego**. Si el jugador no llega, la cita se marca como plantón y deja una impresión negativa; su gravedad depende del carácter del NPC y de si el jugador avisó antes.
- El jugador puede cancelar o reprogramar por chat. Avisar con tiempo suaviza o evita la impresión negativa, según el NPC.
- Cuando el jugador llega, la cita es una escena 1‑a‑1 como cualquier otra y se evalúa igual (§3.2).
- El avance del tiempo debe **detenerse en los límites de las citas**: viajar, esperar o dormir no pueden saltarse la hora acordada sin que el motor la evalúe.

## 4. Lore en segundo plano: relojes de tensión

No hay fechas fijas para los sucesos importantes. Cada suceso ancla tiene un **reloj de tensión** oculto:

- Avanza lentamente con el paso del tiempo (presión natural con variación por partida).
- Se empuja con hitos del jugador y del mundo: unirse a una organización, presenciar algo, ganar exposición, cumplir un paso de una cadena.
- Cuando se llena y se cumplen sus precondiciones, el suceso ocurre.
- Con jugadores muy activos llega antes; con jugadores pasivos llega más tarde, pero llega. Cada Run tiene un ritmo distinto, lo que favorece la rejugabilidad.
- El semillado de la partida hace el ritmo reproducible para depurar.

### 4.1 Los sucesos no cambian; la participación sí
- **El resultado de los sucesos ancla es fijo** (por ejemplo, Porta Magna es atacada). Lo que varía es el papel del jugador, su experiencia y sus consecuencias personales.
- Antes de un acto, el Director consulta qué debe ocurrir («X debe perder contra Y») y el **rol del jugador** («lacayo de Misery», aspirante a héroe, civil) y **fabrica una escena o cadena de misiones** en la que el jugador participa en ese suceso.
- Cómo lo haga afecta a su vida: reputación, relaciones y secretos. Si un NPC cercano no sabe que el jugador trabaja para cierta organización, puede enterarse después si el jugador no es cuidadoso. Los secretos y quién los conoce son estado de la Run, con probabilidades de filtración derivadas de lo que el jugador hizo.

### 4.2 Ondas de distancia
Un suceso llega al jugador según su cercanía: rumor o noticia en el teléfono → efectos locales (cortes, precios, miedo) → presencia directa.

## 5. Exposición y roles emergentes

- **Exposición**: qué tan adentro del universo está el jugador. Sube con sus elecciones (trabajos, afiliaciones, testigos de sucesos, contactos). Determina la frecuencia de encuentros con figuras históricas y el tipo de ganchos que el Director ofrece.
- **Rol emergente**: el motor lleva cuenta de lo que hace (trabajo, vida social, actividad ilegal o heroica, estudio). La ocupación y la aspiración las propone la IA y las confirma el motor con evidencia.
- Un jugador civil puede no cruzarse jamás con los protagonistas; otro puede acabar en el centro de un acto.

## 6. El Director y las interferencias en citas

El Director puede **interponer una misión o un evento** con una cita ya acordada (una emergencia, una oportunidad de la organización) para forzar una decisión: sumar puntos por un lado o cumplir con la persona.

- Solo en momentos de tensión, con causa creíble y ligada a los hilos o al rol del jugador; nunca como un impuesto en cada cita.
- **Presupuesto de tensión:** el motor limita la frecuencia (enfriamiento y máximo por periodo). El GM propone; el motor decide si se permite.
- Siempre hay elección real y consecuencias reales en ambos lados. El jugador conserva el chat para avisar al NPC y mitigar el daño.

## 7. Modelo de datos (borrador)

Canon (`data/canon`, inmutable por Run):
- `timeline/` — sucesos ancla: `id`, `requires`, `tensionMax`, `effectsByRing`, `participationSlots`.
- `npcs/` — `id`, `home`, `work`, `schedule`, `personality`, `likes`, `boundaries`, `tier` (civil / menor / histórico).
- `locations/` — lugares, horarios y acceso.

Estado de la Run:
- `tension.<sucesoId>` — valor, ritmo base, empujes recibidos.
- `relationships.<npcId>` — `contact`, notas ocultas, valores derivados, historial resumido.
- `appointments[]` — `npcId`, `at`, `locationId`, `status` (`agreed`, `attended`, `stood_up`, `cancelled`).
- `secrets[]` y `knowledge[]` — quién sabe qué.
- `threads[]` — cadenas y ganchos activos.
- `seed` — semilla de la partida.

## 8. Orden de construcción (rebanadas verticales)

1. **Presencia y tiempo por eventos.** NPC civiles con rutina; lista de presentes en la escena; el reloj se detiene en límites relevantes (citas, cierres).
2. **Escena 1‑a‑1 e impresiones.** Conversar, cerrar la escena con una evaluación del GM (con evidencia) y notas ocultas.
3. **Teléfono: mensajes, contactos y agenda.** Chat con NPC, acuerdo de citas, espera de 30 minutos, plantón y cancelación.
4. **Cronología y relojes de tensión.** Porta Magna como primer suceso ancla, ondas de distancia y noticias.
5. **Director.** Participación según el rol, secretos y filtraciones, interferencias con presupuesto de tensión.

Cada rebanada debe poder probarse por sí sola antes de pasar a la siguiente.

## 9. Estado de implementación

Prueba de concepto con un solo NPC, **Luna Serp** (`data/canon/npcs/luna_serp.json`, personalidad en borrador salvo que es dueña y barista de una cafetería):

- Hecho: presencia por horario, conversación 1 a 1 con la IA interpretando al NPC, cierre con evaluación del GM, notas ocultas con evidencia y topes, contacto condicionado, bloqueo de otras acciones durante la conversación (`src/server/game/npcs.js`, `run.js`, rutas `/talk`).
- Pendiente: chat por mensajes, citas y espera de 30 minutos, avance del tiempo por eventos, relojes de tensión, Director.
- Herramientas de desarrollo: escribe `/dev` en el chat de acción libre (o abre el juego con `?dev=1`). Comandos: `/reiniciar`, `/regenerar`, `/hora HH:MM [día]`, `/ir lugar`, `/npc [id]`, `/fichas`, `/ayuda`. El panel permite editar, importar y exportar fichas; la app «Notas GM» del teléfono muestra las notas ocultas de cada NPC (solo depuración).
- Fichas de NPC: `data/canon/npcs/<id>.json` (también se pueden soltar ahí a mano). Se importan JSON propios y «character cards» v1/v2/v3 en JSON o PNG (mapeo aproximado que hay que revisar).
- Novela visual: el retrato de un NPC se toma de `assets/portraits/<id>/default.png` (también webp, jpg o svg). Las emociones futuras serán `<emoción>.png` en la misma carpeta y el campo `emotion` de cada línea del NPC. Formato recomendado: WebP con alfa; el lienzo puede ser de cualquier tamaño o proporción (el antiguo «800×1200» ya no es un requisito); el PNG maestro va en `assets/portraits/<id>/source/` (no se sirve). Si una emoción existe en varios formatos se sirve el más ligero (webp > png > jpg > svg). El editor de fichas optimiza al subir (máx. 2048 px de alto, WebP 92% o sin pérdida) y por defecto recorta los márgenes transparentes.
- Encuadre en escena: el campo opcional `stage` de la ficha (`heightCm`, `frames.<emoción> {h,x,y}`, `idle`) fija el tamaño y la posición de cada imagen en **alturas de escenario** (1 = alto de la capa del retrato; `STAGE_CM = 220` cm por escenario), así que se ve igual en teléfono y en pantalla ancha. Una emoción sin frame usa el de `default`; sin frames se usa el render clásico (no hay migración). `src/shared/stage.js` valida y calibra (servidor y cliente). Se edita en Editor de fichas → Emociones → **Encuadrar** (`src/client/framing.js`): arrastrar con un dedo, pellizcar, campos numéricos, regla en cm, fantasma de comparación con otro personaje y calibración por dos toques (coronilla y pies) con la estatura.
- Paquete de personaje (`<id>.hom.json`, `src/server/game/bundle.js`): `{ format: "hom-character", version: 1, exportedAt, card, images: { <emoción>: { type, data(base64) } } }`. `GET /api/dev/npcs/:id/bundle` lo genera (los SVG no se exportan, con aviso; tampoco `source/` ni datos de partida). `POST /api/dev/npcs/import` (hasta 45 MB) lo reconoce por `format`: `parseBundle` valida sin escribir en disco (versión mayor → «versión más nueva»; emociones `^[a-z]{1,20}$` con `default` obligatorio; máx. 60 imágenes, 8 MB cada una y 32 MB en total; el tipo real sale de los bytes mágicos, el `type` declarado no se cree), los lugares desconocidos de `schedule[].locationId` y `home` se sustituyen por el `spawn` del mundo con un aviso (`sanitizeLocations`, que también aplica a la importación de fichas sueltas) y después `validateNpcCard`. `installBundle` instala de forma atómica (carpeta `.incoming-<uuid>`, la antigua pasa a `.old-<uuid>`, ante cualquier fallo se deshace); sobrescribir **reemplaza todas las emociones** y conserva siempre `source/`. Sin `overwrite`, un id existente responde 409 `NPC_EXISTS`.

### Fichas, tiempo y contactos (actualización)
- Ficha de NPC en 5 pestañas: Identidad (edad, género, raza: humano, ophidiano, infernal, celestial, noid), Personalidad (etiquetas, forma de hablar, ejemplo de voz, lenguaje del amor, contacto con condiciones), Apariencia, Historia (trasfondo sin límite, conocimientos, secretos) y Horario y conexiones con otros NPC.
- Conciencia del tiempo: cada NPC recibe la hora actual y cuándo terminó la última conversación (`relacion.ultimaConversacion`, con `mismoDia`) y sus recuerdos con tiempo relativo («hoy a las 09:30, hace 2 horas»).
- Contactos: el NPC solo comparte su usuario (`@LunaSerp`) si el GM lo decide y se cumplen TODAS las condiciones de su ficha, que el GM interpreta; puede pasar durante la conversación (tarjeta en pantalla) o al despedirse. El jugador debe escribir el usuario en Mensajes; si no se lo han compartido, «No agregues a personas desconocidas.». Compartir y agregar son estados distintos.
- Conversación dinámica: la respuesta del NPC se revela poco a poco (un toque la completa). El GM cambia la expresión con una marca de una palabra entre llaves, justo antes del tramo que la lleva: `{feliz} ¡Qué alegría verte! {triste} Pero ya me voy…`. Las emociones disponibles son los nombres de las imágenes de `assets/portraits/<id>/` (solo letras; el motor se las comunica al GM y descarta las marcas desconocidas). La marca nunca se muestra. Sin emociones se usa `default`. Se siguen aceptando `[eliz]` y `[feliz]` (este último solo si es una emoción disponible). La pestaña «Emociones» del editor sube, renombra y elimina sprites (conversión a WebP automática).
- Sprites: los cambios de expresión son cortes limpios (sin fundido, porque las poses no coinciden) y el texto hace una pausa para que se aprecien. Al terminar la respuesta, la expresión vuelve a `default` tras ~2,6 s, salvo la despedida (se queda hasta «Volver») y las emociones marcadas como «Se mantiene» en el editor (escenas largas o íntimas): esas permanecen, también en las siguientes respuestas, hasta que el GM ponga otra marca o `{default}`; el GM recibe `emocionesQueSeMantienen` y `expresionActual`. Velocidad del texto: `/texto lento|normal|rapido`.
- Apertura y cierre: al abrir, el GM recibe sucesos recientes, lugar, hora, relación, recuerdos y estado del contacto; puede ofrecer su contacto desde el inicio, anotar una intención privada (`intent`) que se le devuelve en cada turno y hacer pequeños gestos (sin objetos mecánicos todavía). Al despedirse, una llamada juzga la charla y genera la despedida; la conversación queda cerrada hasta pulsar «Volver».
- Contactos recibidos quedan en el Diario (con botón de copiar y estado) aunque no se agreguen; el NPC sabe cuándo compartió su contacto y, si el jugador no lo agrega ni escribe, puede mencionarlo en el siguiente encuentro según su personalidad.
- Formato: en las líneas del jugador, `*acciones*` y `"diálogos"` se muestran diferenciados y llegan intactos al GM.
- Fichas: Ajustes → «Importar ficha de personaje» (JSON propio o character card JSON/PNG), sin activar el modo desarrollador.
- Pendiente: conocimientos vinculados a un lorebook; chat por mensajes (los NPC ya reciben `escribioAlgunaVez`); objetos y regalos reales con inventario.

### Dos papeles de IA, conocimiento y promesas (actualización)
- **Personaje vs GM.** Dos prompts distintos (`src/server/ai/prompts.js`). El personaje recibe «Interpretas a {nombre}» (sin nombrar la obra ni «NPC»), respuestas de 1 a 6 frases y SOLO lo que ese personaje sabe. El GM narra y traduce a formatos del motor; no interpreta a nadie ni escribe código.
- **Conocimiento limitado por el motor, no por actuación.** El personaje no ve las acciones del jugador por el mundo ni su historia. Sabe el nombre que el jugador le dio (`playerName`, que puede cambiar si miente), los hechos que le contó (`learned`) y lo vivido juntos; todo sale de la evaluación del GM con citas literales validadas.
- **Cierre en dos llamadas simultáneas:** el personaje se despide (y puede compartir su contacto, con las condiciones comprobadas por el motor) mientras el GM evalúa: impresiones, nombre, hechos, acuerdos y pendientes resueltos.
- **Promesas y citas** (`src/server/game/commitments.js`): solo existen cuando ambos llegan a un acuerdo; el GM debe citar la propuesta del jugador y la aceptación explícita del personaje, y el motor comprueba que ambas existan. Tipos: cita, encargo, volver, otro; prioridad alta/media/baja según contexto (el motor la limita: una cita exige lugar y hora; «volveré mañana» sin hora es baja). El personaje espera 30 minutos en el lugar acordado (aunque su horario diga otra cosa); presentarse la cumple; faltar la rompe y resta según la prioridad (alta −2, media −1, baja 0). Los pendientes se recuerdan en las conversaciones y el GM puede marcarlos cumplidos o cancelados con cita del jugador.
- **NorthLife** (antes Social + Mensajes): Feed (los contactos agregados publican; el jugador también), Chats (mensajes de texto con contactos) y Agenda (pendientes e historial).
- **Presupuesto de llamadas.** Durante una conversación solo responde el personaje (ya ve el nombre y lo dicho en la transcripción); al cerrar hay dos llamadas (despedida + evaluación del GM). Los chats NO llaman al GM por mensaje: se acumulan y, cuando el jugador actúa (moverse, esperar, acción libre…), el GM los procesa de fondo en UNA llamada por lote, en paralelo con la narración y solo si contienen algo relevante (nombre, hora, promesa). Las publicaciones del feed se generan en ese mismo viaje, como mucho cada 3 horas de juego. Abrir el teléfono nunca llama a la IA.
- **Acción libre → encuentro:** si el jugador narra que se acerca a hablar con alguien presente, el GM lo traduce y el motor abre la conversación sin pulsar «Hablar con».
- Límites: el texto del jugador admite hasta 4000 caracteres.

### Partidas guardadas y editor de prompts (actualización)
- **Ranuras de partida.** Pantalla «Partidas» (inicio y Ajustes): cada partida es un archivo en `saves/`, con nombre editable (si no, el de tu personaje), día/hora, lugar y contactos. Se puede jugar, renombrar, **duplicar** (copia independiente: sirve para probar sin perder un punto de partida) y eliminar (con confirmación). API: `GET /api/runs`, `DELETE /api/runs/:id`, `POST /api/runs/:id/slot` con `{op:'rename'|'duplicate'}`. Una partida dañada se omite de la lista en vez de romperla.
- **Cuatro prompts, cada uno una lista de módulos** (`src/server/ai/composer.js`, textos de fábrica en `prompts.js`): **Personaje** (conversación en persona), **Texto** (chat de mensajes), **GM** (evalúa conversaciones, narra acciones libres y otras, procesa los chats pendientes) y **Social** (publicaciones del feed y, a futuro, sus respuestas).
- **Módulos.** De *texto* (editables, con macros `{{char}}`, `{{user}}`, `{{player}}`, `{{location}}`, `{{time}}`) o *automáticos* (los rellena el motor: ficha, mundo y momento, lo que sabe del jugador, relación y notas del GM, pendientes, contacto, emociones, intención, conversación…). Cada uno tiene rol (sistema/usuario/asistente), interruptor, orden y, opcionalmente, los tipos de turno en que se envía. Mensajes consecutivos con el mismo rol se unen. `{{user}}` en el prompt del personaje es solo lo que éste sabe (el nombre que le dieron o «la otra persona»); `{{player}}` solo existe para el GM: el motor sigue imponiendo el conocimiento.
- **Obligatorios.** «Instrucción del turno» (texto por tipo de turno: abrir, responder, despedir, evaluar…) y «Formato de salida» (el JSON que el motor sabe leer; bloqueado) no se pueden quitar. En personaje/texto, el prompt de fábrica va en dos módulos: «Prompt principal» (cómo interpretar) y «Reglas del motor» (qué sabe, acuerdos, contacto, emociones), para cambiar lo primero sin romper lo segundo.
- **Editor** (modo desarrollador: `/prompts [personaje|texto|gm|social]` o el panel): reordenar con ↑↓, activar, editar, duplicar, instrucciones por turno, temperatura/top P opcionales, **vista previa** con tu partida abierta sin llamar al modelo, **último enviado** (mensajes y respuesta reales de las últimas llamadas), exportar/importar, restablecer. Los cambios se guardan en `data/prompts/<prompt>.json`; sin archivo se usan los de fábrica.
- **Importar presets de SillyTavern.** Toma el último `prompt_order`, conserva módulos de texto (rol y estado), convierte los marcadores (`charDescription`, `personaDescription`, `chatHistory`, `scenario`/`worldInfoBefore`…) en datos del juego y añade lo que falte (reglas del motor, relación, pendientes…, formato e instrucción del turno). Se carga como borrador; nada cambia hasta guardar.
- Pendiente: lorebook de conocimientos (será otro módulo automático), reordenar arrastrando, perfiles de prompt intercambiables.

### NorthLife como red social (actualización)
- **Es un extra del mundo, no solo de la historia.** El feed tiene publicaciones de cuentas que no son canon (vecinos, bromistas, medios locales…) junto a las canon (`data/canon/social/accounts.json`: @RexNova, dueño de la plataforma, y @NorthLife, con la popularidad que fija el canon) y los contactos del jugador. Hay humor, quejas, curiosidades y pequeños hilos; no todo gira en torno al jugador.
- **El prompt Social genera varias publicaciones en una sola respuesta**, cada una con `usuario`, `nombre`, `hora` (+ `dia`), `texto`, `likes`, `reposts` y `respuestas` (con su propia hora). El motor (`src/server/game/social.js`) lo valida y le da forma: cuentas nuevas permitidas (popularidad máx. 90, sin verificación), nunca suplanta al jugador ni a personajes que el jugador aún no conoce, textos de hasta 280 caracteres, los likes se limitan por la **popularidad de la cuenta** (que decide el motor, no el modelo) y las respuestas siempre llegan después de la publicación.
- **La hora manda.** La hora que indica el modelo es cuando se publica: se guardan programadas y solo se ven cuando el reloj del mundo la alcanza (las de «ahora» o anteriores salen ya). Los likes crecen en ~3 horas hasta su valor final.
- **Cuándo se activa.** Sin que el jugador haga nada, 1–2 veces por día de juego (como mucho cada 10 h de juego), aprovechando la llamada de fondo de una acción del jugador, en paralelo con la narración. Si el jugador publica o responde a un hilo o comentario, se activa en la misma petición (modo `reply`): la red reacciona con respuestas que llegan minutos u horas después; un mensaje trivial de un desconocido puede no recibir nada. Si la IA falla, no se publica nada.
- **Avisos.** Cuando alguien responde a tu publicación o a un comentario tuyo se crea un aviso (pestaña «Avisos» y contador en el icono del teléfono); aparece a la hora de esa respuesta.
- **Popularidad del jugador.** Empieza como un desconocido (5) y crece con su reputación (tope 60): limita los likes de sus publicaciones.
- **Interfaz** (`src/client/northlife.js`): línea de tiempo tipo red social (avatar o retrato, nombre, insignia de verificado, @usuario, hora relativa, comentarios/reposts/likes), «N publicaciones nuevas ↑», hilos con respuestas y «Respondiendo a @…», botón + para publicar, me gusta sin coste de IA. Herramientas de desarrollo: `/feed` o «Generar feed ahora». Para tomar muestras sin rehacer la partida: `/limpiarfeed` o «Limpiar feed» (pide confirmación) borra todas las publicaciones, las cuentas generadas con sus avatares y las notificaciones, y deja el feed listo para generarse de nuevo; conserva tu cuenta de NorthLife, tus contactos y el resto de la partida.
- **Más vida.** Cada activación del prompt Social genera 3–5 publicaciones ya visibles (con sus respuestas) y 2–3 programadas para después. Publicar cuesta 5 minutos de juego (responder, 3): en ese tiempo ya llegan las primeras respuestas. Una publicación del jugador recibe siempre al menos una o dos respuestas y muchas más cuanto más popular es (`expectedReplies`: p. ej. 1–3 con popularidad 5; 6–12 con 60). Si hace más de 2 h de juego que no se generaba el feed, publicar también lo renueva, en paralelo con la reacción (sin sumar espera).
- **Cuenta del jugador.** La primera vez que abre NorthLife crea su cuenta: foto (se recorta y comprime a 256×256 en el navegador), usuario único (3–20 letras, números o _; no puede ser el de un personaje ni el de una cuenta existente) y descripción opcional. No se puede publicar sin cuenta. Su perfil (botón con su foto arriba a la derecha) muestra banner (opcional), usuario, descripción, publicaciones y publicaciones compartidas, y una pestaña de respuestas; puede editarlo y cambiar su usuario (sus publicaciones lo siguen). Las imágenes se guardan en la partida, pero se sirven aparte (`GET /api/runs/:id/media/avatar|banner`) para no inflar cada respuesta. Se puede compartir una publicación ajena (aparece en su perfil).
- **Notificaciones.** Un círculo rojo con el número de notificaciones sin leer aparece sobre el botón del teléfono, sobre el icono de NorthLife y en la pestaña «Notificaciones».
- **Cuentas persistentes y avatares.** Cada cuenta que el servidor registra por primera vez (la propone el modelo, el servidor la valida) guarda en la partida solo: usuario, nombre visible, popularidad, avatar asignado y una muestra de sus dos últimas publicaciones (su «voz»; no se guarda ninguna personalidad ni biografía porque el formato del modelo no las incluye). Los avatares salen de `data/canon/social/avatars.json` (`{"avatars": ["https://…"]}`): se aceptan solo URLs https bien formadas, no vacías ni repetidas (el resto se descarta con un aviso en el registro de desarrollo) y el archivo se relee solo al cambiar. El servidor asigna uno una única vez por cuenta (estable por partida y usuario, prefiriendo uno que nadie más use) y nunca lo vuelve a sortear; el modelo no ve el catálogo ni puede elegir imágenes. Las cuentas canónicas (`accounts.json`: @RexNova, @NorthLife) usan su imagen local `assets/social/accounts/…` y los contactos su retrato; el canon sigue mandando sobre lo que diga el modelo. Si el catálogo está vacío, la URL asignada se retira del catálogo o no carga, se muestra el avatar de respaldo (inicial sobre color). Las partidas anteriores reciben avatar al cargarlas, solo en las cuentas que no lo tenían.
- **Muestra para el modelo, no el registro.** Cada generación recibe un tope fijo de cuentas (canónicas, contactos del jugador, las 4 más populares, las 5 más activas, 5 al azar —determinista por partida y hora de juego— y quienes participan en el hilo) y de 12 publicaciones recientes de 160 caracteres como máximo, para dar continuidad y no repetirse. El motor acepta como máximo 14 publicaciones por generación (el prompt pide 10–12 visibles y 2–4 programadas), 12 respuestas por publicación y 40 cuentas nuevas por generación (quienes publican se registran antes que quienes responden); conserva 120 publicaciones (más las del jugador y las que comparte) y 150 cuentas (priorizando contactos y quienes aún aparecen en el feed).
- Pendiente: sucesos públicos del mundo (Director) como tema de conversación, menciones y seguidores, imágenes en publicaciones.

## 10. Preguntas abiertas

- Cuántos NPC y qué personalidades para la primera rebanada.
- Contenido y límites del romance en escenas explícitas o sensibles.
- Cómo entra el jugador en la Organización de Héroes y qué requisitos tiene.
- Escenas grupales con más de un NPC activo.
- Umbral y forma de las intervenciones excepcionales sobre sucesos ancla (hoy: ninguna).
