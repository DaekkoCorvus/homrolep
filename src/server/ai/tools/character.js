// Herramientas del PERSONAJE (rol `character` en persona, rol `text` en chats). El personaje responde con texto, y en la misma respuesta puede
// «disparar y olvidar» efectos del juego. Estos handlers solo RECOGEN lo que el personaje declara en `state.claims`: no tocan la partida y el
// personaje nunca ve un resultado. El motor valida después cada declaración contra la conversación real (citas literales, condiciones de la
// ficha, lugares que existen): una declaración sin respaldo se descarta sin consecuencias. El personaje no puede viajar, mover dinero ni
// escribir en las notas de nadie: solo ve estas herramientas.
import { createRegistry, reject } from './registry.js';

const PRIORITIES = ['low', 'medium', 'high'];
export const AGREEMENT_KINDS = ['meeting', 'task', 'return', 'other'];
export const MAX_AGREEMENTS_PER_REPLY = 3;
export const MAX_FACTS_PER_REPLY = 4;

const text = (max) => ({ type: 'string', maxLength: max });

export const characterTools = [
  {
    name: 'share_contact',
    description: 'Compartes tu usuario de contacto con el jugador en esta respuesta. Declara en `conditionsMet`, en orden, si cada condición de tu ficha se cumple (true solo si hay hechos claros en la conversación).',
    roles: ['character'], fire: true,
    params: { type: 'object', properties: { conditionsMet: { type: 'array', items: { type: 'boolean' }, maxItems: 32 } }, additionalProperties: false },
    handler({ claims }, { conditionsMet = [] }) {
      claims.contact = { give: true, conditionsMet };
      return { ok: true, result: { noted: true } };
    }
  },
  {
    name: 'agree_plan',
    description: 'Aceptas EXPLÍCITAMENTE, en esta respuesta, un plan o promesa que propuso el jugador (una cita, traer algo, volver). Una propuesta sin tu aceptación no cuenta. `playerQuote` es una cita literal y corta de lo que el jugador propuso. Usa place solo con un id de lugar que exista; para la fecha usa inDays (0 hoy, 1 mañana…) o weekday (0 lunes a 6 domingo), y hour/minute solo si se dijeron.',
    roles: ['character', 'text'], fire: true,
    params: {
      type: 'object', required: ['text', 'kind', 'playerQuote'], additionalProperties: false,
      properties: {
        text: text(200), kind: { type: 'string', enum: AGREEMENT_KINDS }, priority: { type: 'string', enum: PRIORITIES }, place: text(40),
        inDays: { type: 'integer' }, weekday: { type: 'integer' }, hour: { type: 'integer' }, minute: { type: 'integer' }, playerQuote: text(200)
      }
    },
    handler({ claims }, { text: what, kind, priority, place, inDays, weekday, hour, minute, playerQuote }) {
      claims.agreements ??= [];
      if (claims.agreements.length >= MAX_AGREEMENTS_PER_REPLY) return reject('Ya anotaste suficientes acuerdos en esta respuesta.', { code: 'too_many' });
      claims.agreements.push({ text: what, kind, priority, place: place ?? null, when: { inDays: inDays ?? null, weekday: weekday ?? null, hour: hour ?? null, minute: minute ?? null }, playerQuote });
      return { ok: true, result: { noted: true } };
    }
  },
  {
    name: 'remember',
    description: 'Anotas algo que el jugador acaba de decirte: su nombre (kind "name": el que te dio, aunque sea un apodo o falso) o un dato concreto sobre sí mismo (kind "fact"). `quote` es una cita literal y corta de lo que dijo. No inferir: solo lo dicho.',
    roles: ['character', 'text'], fire: true,
    params: { type: 'object', required: ['kind', 'value', 'quote'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['name', 'fact'] }, value: text(200), quote: text(200) } },
    handler({ claims }, { kind, value, quote }) {
      claims.facts ??= [];
      if (claims.facts.length >= MAX_FACTS_PER_REPLY) return reject('Ya anotaste suficiente en esta respuesta.', { code: 'too_many' });
      claims.facts.push({ kind, value, quote });
      return { ok: true, result: { noted: true } };
    }
  },
  {
    name: 'note_to_self',
    description: 'Te dejas una nota privada y breve (una intención o pensamiento) para tu siguiente turno en esta conversación. El jugador no la ve.',
    roles: ['character'], fire: true,
    params: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: text(240) } },
    handler({ claims }, { text: note }) { claims.intent = note; return { ok: true, result: { noted: true } }; }
  },
  {
    name: 'end_conversation',
    description: 'Decides terminar la conversación tú mismo (te vas, cuelgas, la charla llegó a su fin). Lo que escribas en esta respuesta es tu despedida.',
    roles: ['character'], fire: true,
    params: { type: 'object', properties: { reason: text(160) }, additionalProperties: false },
    handler({ claims }, { reason = '' }) { claims.end = { reason }; return { ok: true, result: { noted: true } }; }
  }
];

export const characterRegistry = createRegistry(characterTools);

// Herramientas visibles según el turno: en chat solo acuerdos y datos; en la despedida no se puede «terminar» otra vez;
// compartir el contacto solo si aún no se compartió.
export function characterToolNames({ mode, canShare }) {
  if (mode === 'chat') return ['agree_plan', 'remember'];
  return ['agree_plan', 'remember', 'note_to_self', ...(canShare ? ['share_contact'] : []), ...(mode === 'closing' ? [] : ['end_conversation'])];
}
