# Rediseño de la comunicación motor ↔ modelo

Documento de análisis y propuesta. **No hay código cambiado**: es el punto de partida para decidir. Complementa a [GAMEPLAY_DESIGN.md](GAMEPLAY_DESIGN.md) (§2 «Acción libre: interpretar, validar, resolver, narrar») y respeta las reglas de [AGENTS.md](AGENTS.md): la IA interpreta, el motor decide dinero, inventario, tiempo, estadísticas y estado guardado.

## 1. Cómo funciona hoy

### 1.1 Mapa de llamadas

| Situación | Prompt | Llamadas | Qué devuelve el modelo | Quién lo valida |
| --- | --- | --- | --- | --- |
| Turno en persona (abrir/responder) | `character` | 1 | JSON `{say, gesture, intent, contact?}` con marcas `{emoción}` dentro de `say` | `parseSpeech`, `contactAllowed` |
| Despedida | `character` + `gm` | 2 en paralelo, el jugador espera a ambas | despedida + evaluación (notas, nombre, hechos, acuerdos, pendientes) | `validateEvaluation`, `validateAgreements`, `applyUpdates` |
| Acción libre | `gm` (narration) + fondo | 1 + hasta 2 en paralelo (chats, feed) | `{narration, talkTo}` | `talkTo` debe estar en la lista de presentes |
| Viaje / esperar / dormir / trabajar | `gm` (action) + fondo | 1 + fondo | texto | nada (solo narra lo que el motor ya hizo) |
| Chat NorthLife | `text` | 1 por mensaje | JSON `{say, intent}` | `stripMarks` |
| Chats pendientes | `gm` (chats) | 1 por lote, solo si una regex (`AGREEMENT_HINT`) cree que hay algo relevante | nombre, hechos, acuerdos, pendientes por chat | los mismos validadores |
| Feed | `social` (post) | 1 cada ~10 h de juego | hasta 14 publicaciones con respuestas | `applyGeneratedPosts` |
| Reacción a publicación | `social` (reply) | 1 (+1 feed si hace >2 h) | respuestas, likes, reposts | `applyReactions` |

Todo pasa por un único `chat()` de `provider.js` sobre `chat/completions`: sin `tools`, sin `response_format`, sin leer `usage`. El JSON se «parsea a mano» (`parseJson`) y si falla, la acción entera falla.

### 1.2 Cómo se arma un prompt

`composer.js` replica el modelo de presets de SillyTavern: una lista ordenable de módulos de texto y «automáticos», con roles, macros `{{char}}`, importador de presets de ST y editor completo. `plans.js` rellena los automáticos con claves en español (`loQueSabesDeLaOtraPersona`, `vuestraRelacion`…) serializadas como JSON.

Medido con una conversación real de Luna Serp (`compose` con los textos de fábrica):

| Llamada | Tokens aprox. | De ellos, parte fija |
| --- | --- | --- |
| Turno de personaje | ~2.300 | ~1.300 (prompt + idioma + reglas + formato + ficha) |
| Evaluación del GM | ~1.700 | ~1.300 |
| Narración libre | ~1.000 | ~700 |
| Narración de acción | ~900 | ~700 |

Conclusión honesta: **hoy el problema no es el tamaño**, son cifras razonables. El problema es estructural y el tamaño se volverá problema cuando lleguen el lorebook, más NPC y partidas largas (hoy el motor empuja todo; el modelo no puede pedir nada).

## 2. Diagnóstico

1. **El canal modelo → motor para el mundo libre casi no existe.** `applyAction` con `freeform` solo anota el texto y suma 10 minutos; el GM «narra el intento» y el único efecto real es `talkTo`. «Compro un café», «entro a la tienda», «le pregunto a alguien por el metro», «espero hasta que cierre»: no pasan nada. Los pasos 1–2 del §2 de GAMEPLAY_DESIGN (intención estructurada → validación) no están implementados; solo existen el 3 y 4 para viajar/esperar/dormir/trabajar, que son botones.
2. **Cada llamada inventa su propio protocolo.** Siete formatos JSON distintos, cada uno con su parser y su validador. Los validadores son buenos (citas literales verificadas, topes por encuentro, ids que deben existir): son en la práctica *handlers de herramientas* sin llamarse así.
3. **El personaje hace de actor y de formulario a la vez.** Su respuesta es JSON con diálogo, gesto, intención y estado de contacto. Eso empeora la actuación y obliga a dar margen enorme de tokens a los modelos con razonamiento (`maxTokens*6+4000`, y reintento ×4).
4. **El modelo no puede preguntar.** Todo lo que sabe llega empujado en el prompt. Con lore canónico grande (HOM) no escala; con la ficha entera enviada cada turno (trasfondo, secretos, conexiones) tampoco.
5. **Decisiones semánticas tomadas por el motor con heurísticas.** `AGREEMENT_HINT` (una regex en español) decide si vale la pena llamar al GM sobre un chat.
6. **Latencia evitable.** Cerrar una conversación bloquea al jugador hasta que terminen despedida *y* evaluación, aunque la evaluación solo afecta a la próxima conversación.
7. **El motor no avisa al modelo de lo que pasó.** Los hechos solo llegan si un plan los incluye a mano. NorthLife no recibe sucesos de la partida (`socialInput` no lleva el registro de eventos), así que el feed no puede reaccionar al mundo, contra lo que pide la visión del simulador.
8. **El editor de presets mezcla dos cosas.** Voz y estilo (legítimamente editables) con contrato técnico (formato, reglas del motor) que solo se protege con un candado frágil. El importador de ST añade ~50 líneas y reglas para parchear lo que el preset ajeno no trae.
9. **No hay medición.** No se guarda `usage`, ni latencia, ni qué se rechazó. Optimizar llamadas sin eso es a ciegas.

### Qué ya está bien y hay que conservar

- Separación personaje/GM y conocimiento limitado **por el motor**, no por actuación.
- Validación con evidencia (citas literales), topes por interacción, ids cerrados.
- Muestreo acotado del feed (`PROMPT_LIMITS`): crece el mundo, no el prompt.
- Cancelación con `AbortSignal`, fallo = la partida no cambia, registro de «último enviado».
- Vista previa del prompt sin llamar al modelo.

## 3. Propuesta: registro de herramientas + broker de contexto

Dos piezas, que se pueden construir por separado.

### 3.1 Registro de herramientas («verbos del motor»)

Una sola tabla, `src/server/ai/tools/`, donde cada herramienta declara:

```
name, description, params (JSON Schema),
roles / modos donde está disponible,
kind: 'query' (devuelve datos, cuesta una ida y vuelta) | 'action' (cambia estado, resultado inmediato),
handler(run, args) → { ok, result, hint?, events[] }   // determinista, valida y puede rechazar
```

Reglas de diseño:

- **Intenciones, no valores.** Nunca `setMoney(40)`. Sí `buy(item)`, `spend_time(activity)`: el motor calcula precio, minutos y resultado. Esto cumple «la IA no es autoritativa» por construcción.
- **El rechazo es información.** Un handler devuelve `{ok:false, reason, hint}` («la tienda cierra a las 21:00; puedes esperar o ir mañana»). El modelo lo narra como «sí, pero…». Es el principio de GAMEPLAY_DESIGN §2.
- **Lo que no existe devuelve `no_mechanic`.** `attempt(kind, details)` es la salida para todo lo no implementado: el modelo narra solo el intento, y el motor **registra la intención no soportada** en la traza de desarrollo. Pasa a ser tu lista de qué mecánicas construir después, medida con juego real.
- **Los botones de la UI y la IA usan los mismos handlers.** Viajar, esperar, dormir y trabajar (hoy en `applyAction`) son las primeras herramientas. Así el juego sigue funcionando sin IA (AGENTS.md) y los botones y el modelo no pueden divergir.
- **Todo cambio queda en `eventLog`** como suceso semántico: la verdad sigue siendo el estado de la partida, no la conversación con el modelo.

Herramientas candidatas por rol:

| Rol | Consulta (`query`) | Acción (`action`) |
| --- | --- | --- |
| **GM** (mundo libre, narrativa, cierre) | `scene()`, `who_is_here(place?)`, `place_info(id)`, `recent_events(n)`, `relationship(npc)`, `commitments(npc?)`, `player_status()`, `lore(topic)` *(futuro)* | `travel(place)`, `spend_time(activity, minutes_hint)`, `start_conversation(npc)`, `interact(target, intent)`, `attempt(kind, details)`, `record_impression(npc, text, valence, quote)`, `resolve_commitment(id, status, quote)` |
| **Personaje** (en persona y chat) | `recall(topic)` sobre su ficha profunda | `share_contact(conditions_met)`, `agree_plan(text, kind, place, when)`, `end_conversation(reason)`, `remember(fact, quote)`, `note_to_self(text)` |
| **Feed** | — (se queda con el muestreo empujado) | `submit_batch(posts[])` con el esquema actual |
| **Director** *(futuro)* | `threads()`, `tension(id)`, `world_news()` | `offer_hook(thread)` con presupuesto de tensión del motor |

Observaciones:

- El personaje solo ve **sus** herramientas: no puede viajar, mover dinero ni escribir en notas de otro. El conocimiento limitado sigue siendo del motor.
- `agree_plan` y `remember` mueven la captura de acuerdos y hechos del GM-después al personaje-en-el-momento. La evidencia deja de ser «cita literal extraída tras el hecho» y pasa a ser «el motor comprueba que la última frase del jugador contiene lo que el personaje dice haber aceptado». Se mantiene una **reflexión del GM al cerrar** como red de seguridad y para lo que exige juicio (impresiones con valencia). Detalle en el §5, riesgo 2.
- Los efectos «de disparar y olvidar» (`share_contact`, `note_to_self`, `agree_plan`) **no necesitan segunda vuelta**: van en la misma respuesta que el diálogo y el motor los procesa sin devolverlos al modelo.

### 3.2 Broker de contexto («lo necesario en cada ocasión»)

Reemplaza «módulos ordenables por posición» por **especificaciones de contexto por tipo de llamada**:

1. **Núcleo fijo y mínimo** (cacheable): carta del rol (corta) + herramientas disponibles.
2. **Cabecera ambiente** (~100–200 tokens, calculada por el motor, texto compacto en vez de JSON): hora y día de la semana, lugar, quién está aquí, pendientes próximos, avisos desde la última llamada.
3. **Escena** específica del modo (conversación, acción, lote de chats…).
4. **Bajo demanda**: lo demás, vía herramientas `query`.

Y tres reglas que ahorran de verdad:

- **Proyecciones por rol de un mismo `WorldView`.** El GM ve todo, el personaje solo lo que sabe (`personaOf`, `loQueSabes…` pasan aquí), el feed lo público. Hoy esto está repartido en `plans.js` y `contextFor`.
- **Ficha en dos capas.** `core` siempre (nombre, resumen, personalidad, voz, apariencia si procede); `deep` (trasfondo, secretos, conexiones, conocimientos) se inyecta por **disparadores de palabras clave decididos por el motor** (estilo world-info de ST, pero del motor) y, si hace falta, con `recall(topic)`. Es también la base del lorebook pendiente.
- **Historial con ventana + resumen rodante** en lugar de reenviar toda la conversación.

**Canal de avisos motor → modelo.** Un bus de sucesos: lo que cambió desde la última llamada de ese rol llega como `[Aviso] …` («pasaron 3 h», «la cita de las 18:00 venció», «el jugador publicó algo que se hizo viral»). Es lo que le falta a NorthLife para reaccionar al mundo.

### 3.3 Transporte

- **Llamadas nativas** `tools`/`tool_calls` de la API compatible con OpenAI. La [documentación de NanoGPT](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion.md) describe soporte de *tool calling* con el mismo esquema que OpenAI. Lo que **no** sé es si cada modelo que usas lo respeta con fiabilidad (DeepSeek, Spark, los de razonamiento…): eso se mide con la prueba de la Fase 0, no se asume.
- **Adaptador de reserva** para modelos sin herramientas: el modelo devuelve `{ "say": "...", "calls": [{ "tool": "...", "args": {...} }] }` y el mismo ejecutor lo procesa. El registro no cambia, solo el codec.
- **Bucle con tope**: máximo 3 pasos por llamada, tiempo y tokens acotados, `AbortSignal` propagado. Si el tope se agota, se narra con lo obtenido.
- **Salida estructurada** (`response_format: json_schema`) donde el modelo la soporte, para llamadas de pura extracción.
- **Texto limpio para actuar.** El personaje responde texto con marcas `{emoción}` (el parser actual ya existe) y llama herramientas aparte. Se acaba el JSON envolviendo diálogo.

## 4. Cómo queda cada módulo

- **Mundo libre.** El GM recibe la cabecera ambiente, puede consultar (`who_is_here`, `place_info`) y propone acciones (`travel`, `spend_time`, `start_conversation`, `interact`, `attempt`). El motor resuelve, devuelve resultado o rechazo, y el GM narra **lo que pasó**. El tiempo lo fija el motor por tabla de actividades; el modelo solo aporta una estimación acotada. `talkTo` desaparece, absorbido por `start_conversation`.
- **Narrativa / Director.** Misma maquinaria: `threads()`, `offer_hook()` con presupuesto y enfriamiento del motor, ganchos opcionales y avance fuera de escena. No necesita infraestructura nueva.
- **Encuentros (en persona).** Un turno = una llamada del personaje, texto + marcas + herramientas «disparar y olvidar». El personaje gana capacidades que hoy no tiene: terminar la conversación por sí mismo, apuntarse una nota, aceptar un plan de forma explícita. La despedida sigue bloqueante (es lo que el jugador lee); la reflexión del GM pasa **a segundo plano** y se aplica antes de la siguiente acción, igual que hoy los chats.
- **Chat NorthLife.** El mismo rol de personaje con canal «texto» (sin emociones ni gestos). Al poder llamar `agree_plan` y `remember` en su propia respuesta, desaparece el lote de chats y la regex `AGREEMENT_HINT`.
- **Social / feed.** Se queda como generador por lotes (es creativo, no una decisión de estado) pero entra al mismo registro (`submit_batch`) para compartir validación y traza. Gana el canal de avisos para reflejar sucesos del mundo. El muestreo acotado actual se conserva tal cual.
- **Editor de prompts.** Pasa a editar **voz y estilo**: carta del rol, idioma, capas de estilo y texto por tipo de turno, más temperatura/top-p. Esquemas y herramientas son del código y llevan versión. Se conserva lo más valioso: vista previa y «último enviado», ampliado a **traza** (mensajes, llamadas a herramientas, resultados, rechazos, tokens y latencia). El importador de SillyTavern se limita a traer capas de texto, o se retira.

## 5. Riesgos y decisiones honestas

1. **Más pasos = más latencia.** Una herramienta `query` cuesta una ida y vuelta al modelo. Mitigación: la cabecera ambiente cubre el 90 % de las consultas; se prefiere empujar lo común y reservar `query` para lo opcional; el personaje en conversación casi nunca necesita `query`.
2. **Un modelo de actuación puede olvidar llamar la herramienta** (`agree_plan`, `remember`). Por eso se mantiene la reflexión del GM al cerrar como red de seguridad y se mide en la traza cuántas veces falla cada una. Si falla mucho, se vuelve a extracción posterior para esa herramienta sin tocar el resto.
3. **Fiabilidad de tool-calling variable por modelo.** Hay adaptador JSON de reserva y una prueba previa (Fase 0). Si algún modelo no sirve, no bloquea el proyecto.
4. **Inyección por el texto del jugador.** El jugador no invoca herramientas: el texto es contenido ficticio y los argumentos de cada llamada pasan por el handler (ids cerrados, citas verificadas, topes, rangos). Se mantiene la regla actual.
5. **Compatibilidad de partidas.** El estado guardado casi no cambia (`eventLog`, `relationships`, `commitments` siguen igual). Solo se añaden tipos de suceso. No hace falta migrar saves.
6. **Coste de migración.** Es un cambio de arquitectura de la capa de IA, no de reglas de juego. Se hace por fases con los tests existentes (66) como arnés y el `main` actual como punto de retorno.
7. **No recomiendo** MCP ni un agente autónomo con herramientas arbitrarias: es un registro local, cerrado y validado. Si algún día interesa, el registro se puede exponer por MCP sin rediseñar.

## 6. Plan por fases (cada una se puede probar y dejar funcionando)

0. **Prueba y medición (poca obra).** Leer y guardar `usage`, latencia y errores en el registro de «último enviado». Probar `tools` con los modelos reales y decidir nativo o reserva. *Salida:* datos, no suposiciones.
1. **Registro y ejecutor sin cambiar el juego.** Handlers para `travel`, `wait`, `sleep`, `work` (extraídos de `applyAction`), `start_conversation` y `share_contact`; la UI los llama por el mismo camino; `chat()` acepta `tools` con bucle de tope y codec de reserva. Tests con transporte falso.
2. **Mundo libre con herramientas — hecha.** Cabecera ambiente (`src/server/ai/ambient.js`), GM con `travel`/`wait`/`sleep`/`work`/`spend_time`/`start_conversation`, consultas (`who_is_here`, `place_info`, `recent_events`, `player_status`) y `attempt` → `no_mechanic` con traza de intenciones sin mecánica (`run.intents`, `/intenciones` en modo desarrollador). `talkTo` y el modo `narration` desaparecen (modo `free`). Pendiente: `interact` (sin mecánica que resolver todavía) y medir con modelos reales cuántas llamadas extra cuesta una acción libre. GM con cabecera ambiente, `attempt`/`no_mechanic` y traza de intenciones no soportadas. Es la fase que más cambia lo que *se siente* al jugar.
3. **Rol de personaje unificado.** `character` + `text` → un rol con canal, texto + marcas, herramientas del personaje, evaluación del GM en segundo plano.
4. **Broker de contexto.** Cabecera ambiente compacta, ficha core/deep con disparadores, ventana + resumen del historial, canal de avisos (incluido NorthLife).
5. **Editor de prompts simplificado y traza completa.**
6. **Director y misiones** sobre el mismo registro.

## 7. Decisiones tomadas

1. **Modelos.** Principales: DeepSeek y Muse Spark 1.3, que son los que se conocen. Se añade la opción de un **modelo personalizado** para probar alternativas, y se elimina la comprobación obligatoria al guardar (el botón «Probar conexión» queda como opcional). *(Hecho en la Fase 0.)* Como no se asume que todos los modelos hablen `tools`, el adaptador JSON de reserva es **obligatorio**, no opcional.
2. **SillyTavern y retrocompatibilidad.** El importador de presets de ST y la compatibilidad con versiones anteriores **no importan**: si algo antiguo queda roto, se rehace. Se retirará el importador en la Fase 5 y las partidas viejas no se migran.
3. **Trabajo en segundo plano.** Ninguna acción debe bloquear al jugador esperando al modelo. Aplica al cierre de conversación (la evaluación del GM), y también a **publicar y responder en NorthLife**: la publicación se guarda al instante y la generación de reacciones corre en segundo plano; cuando llegan, el jugador recibe un aviso (sonido/icono) y actualiza el feed cuando quiere. Es la base para actividades simultáneas cuando haya más contenido. Esto se añade al plan como **Fase 1b**.

## 8. Plan por fases actualizado

0. **Prueba y medición — hecha.** Modelo libre y guardado sin verificación; `usage`, tiempo, intentos y modelo en cada llamada; estadísticas por tipo; sonda de modelos (UI en `/dev` → «Sonda de modelos», `/sonda`, y `npm run probe`).
1. **Registro de herramientas y ejecutor — hecha** (sin cambiar el juego): `src/server/ai/tools/` con `travel`, `wait`, `sleep`, `work`, `start_conversation`, `share_contact` (más `free_action`, solo interfaz); los botones y el modelo comparten handlers; `ai.chatWithTools` con `tools` nativas, bucle de 3 pasos y codec JSON de reserva con detección por modelo. Probada con transporte falso (`tests/tools.test.js`); aún no la usa ninguna acción. Pendiente para fases siguientes: `closing` de conversación sigue decidiendo el contacto con `contactAllowed` fuera del registro (Fase 3).
1b. **Trabajo en segundo plano con avisos — parcial** (hecho: cierre de conversación y generación del feed, con bloqueo breve por partida y consulta periódica del cliente; pendiente: reacciones de NorthLife a publicaciones y respuestas del jugador, y «escribiendo…»/sonido). Diseño original: Cola de tareas del servidor por partida: la acción del jugador se aplica y se guarda al instante, y las llamadas al modelo (reacciones de NorthLife, evaluación al cerrar una conversación, feed) corren después; los resultados se aplican al guardar con bloqueo por partida y se avisa al cliente (sondeo o SSE) con un icono/sonido. Hay que decidir cómo se muestran los pendientes («escribiendo…», «N novedades») y qué pasa si el jugador actúa antes de que termine (las tareas se encolan, no se pisan).
2. **Mundo libre con herramientas.**
3. **Rol de personaje unificado — hecha.** `src/server/ai/tools/character.js`: texto + marcas + herramientas «disparar y olvidar» (`agree_plan`, `remember`, `note_to_self`, `share_contact`, `end_conversation`; en chat solo las dos primeras) en una sola llamada, validadas por el motor con citas literales. Desaparecen la regex `AGREEMENT_HINT`, el lote de chats y el modo `chats` del GM. La reflexión del GM al cerrar corre en segundo plano (`pendingEvaluation`, reanudable tras reiniciar) y se aplica antes de que el personaje vuelva a hablar. Medido antes de empezar: `gm:chats` 60 s, `social:post` 88 s, `character:open` 13 s con ~3.000 tokens de entrada.
4. **Broker de contexto** (cabecera ambiente, ficha core/deep, ventana + resumen, avisos).
5. **Editor de prompts simplificado y traza completa**; retirada del importador de ST.
6. **Director y misiones.**
