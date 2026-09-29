# Heroes of Misery — visión del simulador

Documento de dirección para el proyecto. Resume las decisiones expresadas por el creador en la conversación **«HOM ROLEPLAY»** y las correcciones posteriores hechas durante el desarrollo. No sustituye los archivos de canon: los ejemplos de personajes, ciudades y sucesos aquí sirven para explicar el funcionamiento y deben contrastarse con el lore fuente antes de convertirse en datos autoritativos.

## La experiencia que buscamos

Una vida jugable dentro del universo de Heroes of Misery: simulador social cotidiano con libertad de rol, progresión RPG y un Director Narrativo asistido por IA. El jugador no elige al principio una clase, trabajo o destino. Comienza como una persona en el mundo, conoce lugares y gente, toma decisiones y acaba construyendo su posición: civil, aspirante a héroe, agente, aliado de una facción, infiltrado, villano u otra trayectoria plausible.

La partida debe sentirse libre **y** causal. No es un menú de misiones que obliga a seguir una trama, ni un chat sin reglas en el que todo lo narrado se vuelve verdad. Los personajes tienen rutinas, los lugares tienen acceso y horarios, el tiempo pasa, las relaciones y la reputación cambian, y el mundo continúa incluso cuando el jugador decide no participar.

## Bucle de juego

1. El jugador observa una escena concreta: dónde está, cuándo, quién está presente, qué sabe y qué está ocurriendo.
2. Actúa con lenguaje natural o con una acción contextual cómoda en móvil: hablar, desplazarse, trabajar, investigar, descansar, publicar, etc.
3. El motor valida posibilidades y consecuencias duras; la IA interpreta intención, diálogo y detalles narrativos dentro de esos límites.
4. Avanzan el reloj, las rutinas, los eventos locales y los hilos narrativos que correspondan. El jugador recibe una respuesta clara y ve solo los cambios que podría percibir.
5. La vida ordinaria y las oportunidades emergentes se alternan. Aprender el mundo, establecer vínculos y desarrollar un oficio deben ser interesantes incluso entre eventos grandes.

Un inicio adecuado presenta días relativamente tranquilos y oportunidades pequeñas. La intensidad aumenta por lo que el jugador hace, por las personas con quienes se relaciona y por acontecimientos causales; no por una avalancha inicial de botones o tareas.

## Personaje y comienzo de una Run

El umbral de creación es místico y automático: tras confirmar una nueva partida, el portal se abre y la entidad parece moldear una vida con preguntas breves sobre edad, género (hombre, mujer o personalizado), apariencia e historia opcional. Después interrumpe el cruce para preguntar el nombre. La apariencia se guarda como referencia privada para interacciones pertinentes con NPC; no se muestra en la ficha ni se envía al prólogo o a narraciones generales. Por ahora la raza humana se asigna como única opción disponible. El GM elegido usa edad, identidad e historia para crear un prólogo breve y situar al personaje en la estación Umbral de Hierro en Northfortress. La ocupación y la aspiración **no** se preguntan en la creación: se descubren, eligen y transforman jugando.

Una nueva Run y las acciones de juego requieren conexión NanoGPT verificada. Ajustes y partidas guardadas siguen accesibles sin ella. Si falla una llamada de IA, no se crea ni avanza la Run. La clave permanece en el servidor local, nunca en el cliente ni en Git.

## Libertad del jugador y coherencia del canon

La dirección elegida **no** es congelar épocas ni suspender la historia para que nada cambie; tampoco pretende abrir una infinidad de ramas donde cualquier acción reescribe fácilmente los sucesos centrales. La historia del universo progresa. El foco está en **qué papel desempeña el jugador, cómo participa, qué descubre y qué consecuencias personales o locales provoca**.

El Director Narrativo debe encauzar las oportunidades mediante causalidad, distancia, información, relaciones, acceso y capacidad real del personaje. No debería responder con un «no puedes porque el canon lo prohíbe» ni borrar una acción válida. Si el jugador interviene cerca de un suceso importante, el sistema debe resolver su intervención con honestidad y mantener un mundo coherente; todavía queda por definir qué sucesos específicos son anclas y cómo manejar intervenciones excepcionales que puedan alterarlos.

La época moderna compartida con personajes como Abdiel fue la preferencia expresada en la conversación. Antes de convertir esa preferencia en una línea temporal exacta o en fichas de NPC definitivas, hay que verificar los archivos de lore canónico. Empezar con Northfortress como centro profundo resulta compatible con esa visión; la extensión inicial a otras regiones sigue abierta.

## Director Narrativo: oportunidades, no rieles

El Director prepara hilos causales y presenta *ganchos* cuando el contexto lo permite. Un gancho es una oportunidad, no una misión forzada. El jugador puede aceptarla, ignorarla, rechazarla o actuar de otra manera. Si la ignora, el mundo sigue: el hilo puede avanzar fuera de escena, terminar sin él o generar más adelante **otra** oportunidad verosímil, no la misma invitación repetida hasta que acepte.

Ejemplo de intención, no de guion fijo: despertarse de noche, decidir volver a dormir o levantarse; una necesidad cotidiana conduce a salir, encontrar a alguien y quizá entrar en una cadena que acerque a una facción. En otra Run, el jugador puede buscar por iniciativa propia resolver robos locales o solicitar acceso a X-Corp; el Director responde a esa trayectoria. Alguien podría servir a Misery, infiltrarse en otra organización o romper con sus antiguos aliados, con consecuencias creíbles.

Las misiones futuras deben admitir soluciones semánticas: observar el objetivo y la evidencia de lo ocurrido, no exigir una única lista rígida de pasos. La IA puede proponer, interpretar y evaluar; el motor verifica requisitos, cambios de estado y recompensas. Una misión puede resolverse de maneras distintas, fallar, caducar o perder relevancia. Ninguna salida de la IA debe otorgar por sí sola dinero, objetos, estadísticas o permisos.

## Mundo social vivo

- **Tiempo y lugares.** Un reloj simulado de 24 horas, día/noche distinguibles, desplazamientos con duración y ubicaciones con acceso y actividad acordes a la hora. El tiempo avanza por acciones, no por esperar tiempo real frente a la pantalla.
- **NPC con rutina.** Obligaciones relativamente estables según su rol, tiempos libres con variación ponderada y excepciones provocadas por la historia. Las rutinas deben poder aprenderse sin volverse una tabla infalible. Un personaje importante no aparece mágicamente donde conviene al jugador; las relaciones, el acceso y su agenda importan.
- **Conocimiento situado.** Separar lo verdadero en el mundo de lo que saben el jugador y cada NPC. Rumores, publicaciones y testimonios no son conocimiento omnisciente; el lore se descubre jugando.
- **Relaciones y reputación.** Conversaciones, favores, conflictos, trabajo y publicaciones sociales producen memoria y consecuencias. El feed social debe reaccionar a hechos de la Run y afectar cómo se percibe al personaje, no ser un minijuego aislado.
- **Roles emergentes.** Trabajo, aspiración, habilidades, entrenamiento, equipo, patrocinio y afiliaciones surgen de oportunidades y decisiones durante la partida. Combate por turnos, simulación amplia de NPC y sistemas completos de habilidades quedan para etapas posteriores.
- **NPC creados por el jugador.** Es una capacidad deseada, pero no parte de la primera implementación.

Las referencias a la cafetería, X-Corp, Northfortress, Heartstone/Metrocity y otras regiones ilustran el tipo de historias imaginadas por el creador. Sus detalles históricos y geográficos aún necesitan pasar a datos canon revisados antes de programar reglas sobre ellos.

## Responsabilidades del sistema

| Capa | Responsabilidad |
| --- | --- |
| Canon (`data/canon`) | Hechos base, lugares, personajes y cronología aprobados; no cambia por una Run. |
| Estado de Run | Tiempo, ubicación, recursos, vínculos, reputación, conocimientos, misiones, hilos y cambios propios de esa partida. |
| Motor de reglas | Validar acciones y calcular efectos deterministas: acceso, dinero, inventario, tiempo, estadísticas y persistencia. |
| IA / Director | Narrar escenas, interpretar intención y diálogo, proponer eventos y evaluar significado con información acotada. |
| Interfaz | Mostrar el contexto y las consecuencias entendibles, recoger intención y ofrecer acciones pertinentes sin exponer el motor como una consola de botones. |

La integración de IA funciona a través del servidor local. El motor no debe colocar lore canónico dentro del código de reglas ni aceptar una respuesta de IA como verdad mecánica. Los sucesos visibles, los rumores y los hechos internos del mundo necesitan representaciones diferentes.

## Dirección para el próximo rediseño de interfaz

Este documento **no** pide rediseñar todavía las pantallas. Sí fija el criterio: en teléfono, la escena actual y una acción principal deben tener prioridad visual. Ubicación, hora, personas presentes y consecuencia reciente han de entenderse de un vistazo; las acciones contextuales aparecen cuando son pertinentes. Inventario, diario, mapa, feed y ajustes pueden estar disponibles sin competir siempre por la atención con la escena. La navegación debe sentirse como una aplicación, con pocos controles persistentes y objetivos táctiles cómodos.

Antes de dibujar pantallas definitivas, probar una escena vertical completa: llegar a un lugar, encontrar a un NPC según su rutina, hablar, recibir o rechazar una oportunidad, avanzar el tiempo y ver la consecuencia. Esa prueba dirá qué controles son realmente necesarios.

## Orden de implementación propuesto

1. **Escena jugable y estado observable:** presencia de NPC, contexto horario y disponibilidad de acciones, sin depender de listas de botones globales.
2. **Rutina mínima de NPC y relaciones:** unos pocos personajes y lugares revisados, con agenda, interacción y memoria por Run.
3. **Director Narrativo acotado:** un hilo causal pequeño con gancho opcional, rechazo válido y avance fuera de escena; respuestas de IA sujetas a validación.
4. **Objetivos semánticos y consecuencias sociales:** evaluación con evidencia, reputación/relaciones y feed conectado a sucesos reales.
5. **Ampliación gradual:** regiones, roles, habilidades, equipo y combate cuando el bucle anterior resulte divertido y consistente.

## Estado actual y decisiones pendientes

El prototipo ya tiene creación escalonada, prólogo y narración por NanoGPT, ubicación inicial, reloj, guardado y feed básico. **Aún no simula** rutinas de NPC, relaciones, Director Narrativo, misiones semánticas ni evolución real de ocupación/aspiración. Las narraciones actuales no adjudican por sí mismas esos cambios.

Permanecen abiertas: canon exacto y cronología de partida; límites de intervención sobre acontecimientos mayores; primer conjunto de lugares/NPC; alcance geográfico inicial; reglas concretas de habilidades, combate y publicación social. Las ideas antiguas de «épocas congeladas» o de una línea argumental detenida **no** deben asumirse como decisiones vigentes.
