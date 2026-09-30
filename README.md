# Heroes of Misery RPG

Prototipo mobile-first de un simulador social y RPG narrativo ambientado en el universo de Heroes of Misery. Esta primera versión ofrece un pequeño mundo funcional; no pretende implementar todavía el lore, combate ni dirección narrativa con IA completos.

La dirección del proyecto, las decisiones tomadas en «HOM ROLEPLAY» y lo que sigue pendiente están en [la visión del simulador](HOM_SIMULATOR_VISION.md). Ese documento guía las siguientes implementaciones y sustituye como referencia de diseño al plan inicial de bootstrap.

## Estado

**Prototype / MVP.** Incluye creación de personaje por escenas, prólogo y narración de acciones con NanoGPT, llegada a una ubicación de Northfortress, persistencia de Runs, reloj de mundo, Event Log semántico, feed social y un shell PWA adaptable a teléfonos.

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

## Pruebas

```bash
npm test
```

## Configuración y seguridad

En la pantalla inicial, abre **Ajustes**, pega tu API key de NanoGPT y elige un GM: **Spark 1.3** (interpretativo y estricto) o **DeepSeek** (creativo y más suave). Pulsa **Probar y guardar**: se realiza una llamada de Chat Completions y solo si responde se habilita **Nueva partida**. La prueba, las frases de la entidad y las narraciones pueden consumir saldo o cuota de NanoGPT. No envíes tu key por chat ni la introduzcas en archivos del repositorio.

La key se guarda en `.local/ai.json` en el servidor local, fuera de Git y de las partidas; el navegador nunca la guarda en localStorage ni la recibe de vuelta por la API. **Olvidar API key** la elimina. Este prototipo es para uso local de una persona; mantén protegidos el dispositivo y esa carpeta. La historia inicial, el personaje, las acciones y hasta 12 eventos recientes se envían a NanoGPT. Las frases breves y personalizadas de la entidad usan `deepseek/deepseek-v4.1-flash`; el GM que elijas narra la llegada a la estación y las acciones. Si NanoGPT falla al crear la partida o narrar una acción, no se guarda ningún avance; las frases de la entidad tienen un texto de respaldo. Las partidas existentes se pueden leer sin conexión configurada.

La creación pregunta edad, género, apariencia e historia personal opcional; el nombre se pide justo antes de cruzar. La apariencia se guarda como referencia para futuras interacciones con NPC, pero no aparece en la ficha ni se envía al GM durante el prólogo o narraciones generales. La raza humana se asigna automáticamente por ser la única disponible. El prólogo comienza en la estación Umbral de Hierro. Ocupación y aspiración quedan sin definir al inicio y se desarrollarán durante el juego. El atajo de trabajo solo funciona en partidas que ya tengan la ocupación `worker`.

## Arquitectura

```text
src/client/             interfaz web mobile-first
src/server/index.js     servidor HTTP y API local
src/server/game/        reglas deterministas y contratos futuros
src/server/saves/       persistencia JSON atómica
src/server/ai/          interfaz del proveedor de IA
assets/                 recursos visuales, incluido el vórtice liminal
data/canon/             datos base inmutables del universo
data/templates/         esquemas de contenido futuro
public/                 manifest y service worker
saves/                  estado de Runs (fuera de Git)
tests/                  pruebas de reglas de juego
```

`CANON` describe el estado base. Cada `RUN STATE` guarda únicamente los cambios de una partida. Una Run nunca modifica los archivos canon.

El código es autoridad para dinero, inventario, tiempo, estadísticas, acceso, ubicación válida y persistencia. La IA interpreta la creación y las acciones, pero aún no modifica ocupación, aspiración, misiones ni otros sistemas de juego: eso se desarrollará en futuras iteraciones.

## API local

- `GET /api/world` — mundo de prueba
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
