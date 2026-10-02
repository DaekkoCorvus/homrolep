// Cada llamada a la IA se describe como un «plan»: qué prompt usa (kind), de qué tipo de turno es (mode), los datos del juego que
// rellenan los módulos automáticos (data), las macros ({{char}}…) y el formato de salida que exige el motor.
// El compositor (composer.js) lo convierte en mensajes. Separado del proveedor para poder previsualizar el prompt sin llamar al modelo.
import { characterFormat, GM_FORMATS, SOCIAL_FORMATS } from './prompts.js';

export const personaOf = (npc) => ({
  nombre: npc.name, edad: npc.age, genero: npc.gender, raza: npc.race, rol: npc.role, resumen: npc.summary,
  apariencia: npc.appearance, prendasQueTeAgradan: npc.clothingLikes, prendasQueEvitas: npc.clothingDislikes,
  personalidad: npc.personality, ejemplosDeVoz: npc.exampleDialogue, trasfondo: npc.background,
  conocimientos: npc.knowledge, secretos: npc.secrets, conexiones: npc.connections
});

const playerGender = (player) => (player.gender === 'custom' ? player.genderCustom : player.gender);
const clock = (world) => (world ? `Día ${world.day}, ${String(world.hour).padStart(2, '0')}:${String(world.minute).padStart(2, '0')}` : '');

// PERSONAJE (en persona) o TEXTO (chat): solo recibe lo que ese personaje sabe.
export function characterPlan({ npc, player, location, relationship, attitude, transcript, mode = 'reply', temporal, memories, history, emotions = [], stickyEmotions = [], currentExpression = null, contact, intent, commitments, instruction }) {
  const chat = mode === 'chat';
  const canShare = contact?.yaCompartido !== true;
  const sees = { edadAparente: player.age, genero: playerGender(player), apariencia: player.appearance };
  const user = relationship.knownName || 'la otra persona';
  return {
    kind: chat ? 'text' : 'character', mode, instruction,
    format: characterFormat({ canShare, mode }),
    macros: { char: npc.name, user, location: chat ? '' : location?.name ?? '', time: temporal.ahora },
    data: {
      tu: personaOf(npc),
      ahora: temporal.ahora,
      lugar: chat ? undefined : { nombre: location?.name, descripcion: location?.description },
      loQueSabesDeLaOtraPersona: { nombreQueTeDio: relationship.knownName || null, loQueVes: chat ? undefined : sees, cosasQueTeHaContado: relationship.knows?.length ? relationship.knows : undefined },
      vuestraRelacion: { actitud: attitude, primerEncuentro: !relationship.encounters, ultimaConversacion: temporal.ultimaConversacion, recuerdosPrivados: memories, resumenesPrevios: history },
      pendientesConEstaPersona: commitments?.length ? commitments : undefined,
      contacto: contact,
      emocionesDisponibles: chat ? undefined : emotions,
      emocionesQueSeMantienen: !chat && stickyEmotions.length ? stickyEmotions : undefined,
      expresionActual: currentExpression || undefined,
      tuIntencionAnterior: intent || undefined,
      conversacion: transcript.filter((line) => line.who === 'player' || line.who === 'npc').map((line) => ({ quien: line.who === 'player' ? 'la otra persona' : npc.name, texto: line.text }))
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

// GM narrando una acción. `freeform` puede activar un encuentro con alguien presente.
export function narrationPlan(mode, before, after, worldData, present = []) {
  const player = after.player;
  const here = worldData.locations.find(({ id }) => id === player.locationId);
  return {
    kind: 'gm', mode, format: GM_FORMATS[mode],
    macros: { player: player.name, user: player.name, location: here?.name ?? '', time: clock(after.world) },
    data: {
      jugador: { nombre: player.name, edad: player.age, genero: player.gender, genderCustom: player.genderCustom, raza: player.race, origen: player.origin, ocupacion: player.occupation, aspiracion: player.aspiration, dinero: player.money, reputacion: player.reputation },
      mundo: after.world, lugar: here, prologo: before.prologue?.text, sucesosRecientes: before.eventLog.slice(-12), accion: after.eventLog.at(-1), lugarAnterior: before.player.locationId,
      personasPresentes: mode === 'narration' ? present : undefined
    }
  };
}

// GM procesando chats pendientes (todos los personajes en una sola llamada).
export function chatsPlan({ chats, locations = [], ahora, playerName = '' }) {
  return {
    kind: 'gm', mode: 'chats', format: GM_FORMATS.chats,
    macros: { player: playerName, user: playerName, time: ahora },
    data: {
      ahora, lugares: locations,
      chats: chats.map((item) => ({ npcId: item.npcId, personaje: item.name, pendientes: item.commitments, mensajes: item.lines.map((line) => ({ quien: line.who === 'player' ? 'jugador' : item.name, texto: line.text })) }))
    }
  };
}

// SOCIAL: publicaciones del feed.
export function feedPlan({ authors, ahora, playerName = '' }) {
  return { kind: 'social', mode: 'post', format: SOCIAL_FORMATS.post, macros: { player: playerName, time: ahora }, data: { ahora, personajes: authors } };
}
