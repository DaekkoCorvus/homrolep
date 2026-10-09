// Cada llamada a la IA se describe como un «plan»: qué prompt usa (kind), de qué tipo de turno es (mode), los datos del juego que
// rellenan los módulos automáticos (data), las macros ({{char}}…) y el formato de salida que exige el motor.
// El compositor (composer.js) lo convierte en mensajes. Separado del proveedor para poder previsualizar el prompt sin llamar al modelo.
import { characterFormat, GM_FORMATS, SOCIAL_FORMATS } from './prompts.js';
import { coreOf, deepEntries, selectDeep, queryFrom, deepView } from './context/card.js';
import { windowOf } from './context/history.js';
import { noticesSince } from './context/notices.js';

export const personaOf = (npc) => ({
  nombre: npc.name, edad: npc.age, genero: npc.gender, raza: npc.race, rol: npc.role, resumen: npc.summary,
  apariencia: npc.appearance, prendasQueTeAgradan: npc.clothingLikes, prendasQueEvitas: npc.clothingDislikes,
  personalidad: npc.personality, ejemplosDeVoz: npc.exampleDialogue, trasfondo: npc.background,
  conocimientos: npc.knowledge, secretos: npc.secrets, conexiones: npc.connections
});

const playerGender = (player) => (player.gender === 'custom' ? player.genderCustom : player.gender);
const clock = (world) => (world ? `Día ${world.day}, ${String(world.hour).padStart(2, '0')}:${String(world.minute).padStart(2, '0')}` : '');

// PERSONAJE (en persona) o TEXTO (chat): solo recibe lo que ese personaje sabe.
const WINDOW = { person: 16, chat: 12 }; // intervenciones que se reenvían; lo importante ya quedó en recuerdos, datos y pendientes
export function characterPlan({ npc, player, location, relationship, attitude, transcript, mode = 'reply', temporal, memories, history, emotions = [], stickyEmotions = [], currentExpression = null, contact, intent, commitments, instruction }) {
  // Broker de contexto: ficha en dos capas (la profunda solo si viene al caso), escena en una línea de texto y ventana de conversación.
  const chat = mode === 'chat';
  const deep = selectDeep(deepEntries(npc), queryFrom(transcript, intent));
  const spoken = windowOf(transcript.filter((line) => line.who === 'player' || line.who === 'npc'), chat ? WINDOW.chat : WINDOW.person);
  const canShare = contact?.yaCompartido !== true;
  const sees = { edadAparente: player.age, genero: playerGender(player), apariencia: player.appearance };
  const user = relationship.knownName || 'la otra persona';
  return {
    kind: chat ? 'text' : 'character', mode, instruction,
    format: characterFormat({ canShare, mode }),
    macros: { char: npc.name, user, location: chat ? '' : location?.name ?? '', time: temporal.ahora },
    data: {
      tu: coreOf(npc),
      tuMemoria: deepView(deep),
      escena: `Ahora: ${temporal.ahora}.${chat || !location?.name ? '' : ` Lugar: ${location.name}${location.description ? ` — ${location.description.replace(/[.\s]+$/, '')}` : ''}.`}`,
      loQueSabesDeLaOtraPersona: { nombreQueTeDio: relationship.knownName || null, loQueVes: chat ? undefined : sees, cosasQueTeHaContado: relationship.knows?.length ? relationship.knows : undefined },
      vuestraRelacion: { actitud: attitude, primerEncuentro: !relationship.encounters, ultimaConversacion: temporal.ultimaConversacion, recuerdosPrivados: memories, resumenesPrevios: history },
      pendientesConEstaPersona: commitments?.length ? commitments : undefined,
      contacto: contact,
      emocionesDisponibles: chat ? undefined : emotions,
      emocionesQueSeMantienen: !chat && stickyEmotions.length ? stickyEmotions : undefined,
      expresionActual: currentExpression || undefined,
      tuIntencionAnterior: intent || undefined,
      conversacion: [...(spoken.omitted ? [{ nota: `Antes de esto hubo ${spoken.omitted} intervenciones más; lo importante ya está en tus recuerdos y pendientes.` }] : []), ...spoken.lines.map((line) => ({ ...(line.n ? { n: line.n } : {}), quien: line.who === 'player' ? 'la otra persona' : npc.name, texto: line.text, ...(line.replyTo?.text ? { respondeA: String(line.replyTo.text).slice(0, 120) } : {}) }))]
    }
  };
}

// GM al cerrar una conversación: traduce lo ocurrido a datos del motor.
export function evaluationPlan({ npc, player, relationship, attitude, transcript, temporal, memories, locations = [], commitments = [] }) {
  return {
    kind: 'gm', mode: 'evaluation', format: GM_FORMATS.evaluation,
    macros: { char: npc.name, player: player?.name ?? '', user: player?.name ?? '', time: temporal.ahora },
    data: {
      personaje: { nombre: npc.name, rol: npc.role, resumen: npc.summary, personalidad: npc.personality },
      ahora: temporal.ahora,
      relacion: { actitudPrevia: attitude, ultimaConversacion: temporal.ultimaConversacion, recuerdosPrivados: memories },
      pendientes: commitments, lugares: locations,
      conversacion: transcript.filter((line) => line.who === 'player' || line.who === 'npc').map((line) => ({ quien: line.who === 'player' ? 'jugador' : npc.name, texto: line.text }))
    }
  };
}

const playerView = (player) => ({ nombre: player.name, edad: player.age, genero: player.gender, genderCustom: player.genderCustom, raza: player.race, origen: player.origin, ocupacion: player.occupation, aspiracion: player.aspiration, dinero: player.money, reputacion: player.reputation });

// GM narrando una acción que el motor ya aplicó (viajar, esperar, dormir, trabajar).
export function narrationPlan(mode, before, after, worldData, npcs = new Map()) {
  const player = after.player;
  const here = worldData.locations.find(({ id }) => id === player.locationId);
  return {
    kind: 'gm', mode, format: GM_FORMATS[mode],
    macros: { player: player.name, user: player.name, location: here?.name ?? '', time: clock(after.world) },
    data: { jugador: playerView(player), mundo: after.world, lugar: here, prologo: before.prologue?.text, sucesosRecientes: noticesSince(before, { worldData, npcs, max: 8 }), accion: after.eventLog.at(-1), lugarAnterior: before.player.locationId }
  };
}

// GM en el mundo libre: recibe la cabecera ambiente (texto calculado por el motor) y la acción escrita; actúa con herramientas.
export function worldPlan(run, worldData, header) {
  const player = run.player;
  const here = worldData.locations.find(({ id }) => id === player.locationId);
  return {
    kind: 'gm', mode: 'free', format: GM_FORMATS.free,
    macros: { player: player.name, user: player.name, location: here?.name ?? '', time: clock(run.world) },
    // Los sucesos recientes van en la cabecera (avisos desde la última intervención); aquí solo la última narración, para continuar la historia.
    data: { cabecera: header, jugador: playerView(player), prologo: run.prologue?.text, ultimaNarracion: run.narrative?.text ? run.narrative.text.slice(0, 700) : undefined, accion: run.eventLog.at(-1) }
  };
}

// SOCIAL (NorthLife): genera publicaciones del feed (mode 'post') o reacciona a lo que hizo el jugador (mode 'reply').
// `input` lo prepara game/social.js → socialInput().
export function socialPlan(input) {
  const { mode, ahora, dia, ciudad, lugares, avisos, cuentas, recientes, jugador, publicacion, accionDelJugador, respuestasEsperadas } = input;
  return {
    kind: 'social', mode, format: SOCIAL_FORMATS[mode],
    macros: { player: jugador?.nombre ?? '', time: ahora },
    data: { ahora, dia, ciudad, lugares, avisos, cuentas, jugador, recientes, publicacion, accionDelJugador, respuestasEsperadas }
  };
}
