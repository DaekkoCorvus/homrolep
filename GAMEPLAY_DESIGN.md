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
- Novela visual: el retrato de un NPC se toma de `assets/portraits/<id>/default.png` (también webp, jpg o svg). Las emociones futuras serán `<emoción>.png` en la misma carpeta y el campo `emotion` de cada línea del NPC. Formato recomendado: WebP con alfa, lienzo 2:3 de 800×1200 px, mismo encuadre en todas las emociones; el PNG maestro va en `assets/portraits/<id>/source/` (no se sirve). Si una emoción existe en varios formatos se sirve el más ligero (webp > png > jpg > svg). El editor de fichas optimiza al subir (máx. 1200 px de alto, WebP 92% o sin pérdida).

### Fichas, tiempo y contactos (actualización)
- Ficha de NPC en 5 pestañas: Identidad (edad, género, raza: humano, ophidiano, infernal, celestial, noid), Personalidad (etiquetas, forma de hablar, ejemplo de voz, lenguaje del amor, contacto con condiciones), Apariencia, Historia (trasfondo sin límite, conocimientos, secretos) y Horario y conexiones con otros NPC.
- Conciencia del tiempo: cada NPC recibe la hora actual y cuándo terminó la última conversación (`relacion.ultimaConversacion`, con `mismoDia`) y sus recuerdos con tiempo relativo («hoy a las 09:30, hace 2 horas»).
- Contactos: el NPC solo comparte su usuario (`@LunaSerp`) si el GM lo decide y se cumplen TODAS las condiciones de su ficha, que el GM interpreta; puede pasar durante la conversación (tarjeta en pantalla) o al despedirse. El jugador debe escribir el usuario en Mensajes; si no se lo han compartido, «No agregues a personas desconocidas.». Compartir y agregar son estados distintos.
- Conversación dinámica: la respuesta del NPC se revela poco a poco (un toque la completa). El GM puede cambiar la expresión dentro de la frase con marcas `[eliz] ¡Qué alegría! [preocupada] ¿Estás bien?`; las emociones disponibles son las imágenes que existan en `assets/portraits/<id>/<emoción>.webp` (el motor se las comunica al GM y descarta las marcas desconocidas). Sin emociones se usa `default`.
- Apertura y cierre: al abrir, el GM recibe sucesos recientes, lugar, hora, relación, recuerdos y estado del contacto; puede ofrecer su contacto desde el inicio, anotar una intención privada (`intent`) que se le devuelve en cada turno y hacer pequeños gestos (sin objetos mecánicos todavía). Al despedirse, una llamada juzga la charla y genera la despedida; la conversación queda cerrada hasta pulsar «Volver».
- Contactos recibidos quedan en el Diario (con botón de copiar y estado) aunque no se agreguen; el NPC sabe cuándo compartió su contacto y, si el jugador no lo agrega ni escribe, puede mencionarlo en el siguiente encuentro según su personalidad.
- Formato: en las líneas del jugador, `*acciones*` y `"diálogos"` se muestran diferenciados y llegan intactos al GM.
- Fichas: Ajustes → «Importar ficha de personaje» (JSON propio o character card JSON/PNG), sin activar el modo desarrollador.
- Pendiente: conocimientos vinculados a un lorebook; chat por mensajes (los NPC ya reciben `escribioAlgunaVez`); objetos y regalos reales con inventario.

## 10. Preguntas abiertas

- Cuántos NPC y qué personalidades para la primera rebanada.
- Contenido y límites del romance en escenas explícitas o sensibles.
- Cómo entra el jugador en la Organización de Héroes y qué requisitos tiene.
- Escenas grupales con más de un NPC activo.
- Umbral y forma de las intervenciones excepcionales sobre sucesos ancla (hoy: ninguna).
