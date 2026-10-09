// Herramientas del PERSONAJE (rol `character` en persona, rol `text` en chats). El personaje responde con texto, y en la misma respuesta puede
// «disparar y olvidar» efectos del juego. Estos handlers solo RECOGEN lo que el personaje declara en `state.claims`: no tocan la partida y el
// personaje nunca ve un resultado. El motor valida después cada declaración contra la conversación real (citas literales, condiciones de la
// ficha, lugares que existen): una declaración sin respaldo se descarta sin consecuencias. El personaje no puede viajar, mover dinero ni
// escribir en las notas de nadie: solo ve estas herramientas.
import { createRegistry, reject } from './registry.js';
import { selectDeep } from '../context/card.js';

const PRIORITIES = ['low', 'medium', 'high'];
export const AGREEMENT_KINDS = ['meeting', 'task', 'return', 'other'];
export const MAX_AGREEMENTS_PER_REPLY = 3;
export const MAX_FACTS_PER_REPLY = 4;

const text = (max) => ({ type: 'string', maxLength: max });

export const characterTools = [
  {
    name: 'share_contact',
    description: 'Compartes tu usuario de contacto en esta respuesta. `conditionsMet`: un booleano por condición de tu contacto, en orden; true solo con hechos claros en la conversación.',
    roles: ['character'], fire: true,
    params: { type: 'object', properties: { conditionsMet: { type: 'array', items: { type: 'boolean' }, maxItems: 32 } }, additionalProperties: false },
    handler({ claims }, { conditionsMet = [] }) {
      claims.contact = { give: true, conditionsMet };
      return { ok: true, result: { noted: true } };
    }
  },
  {
    name: 'agree_plan',
    description: 'Aceptas EXPLÍCITAMENTE en esta respuesta un plan o promesa que propuso la otra persona (cita, traer algo, volver); una propuesta que no aceptas no cuenta. `playerQuote`: cita literal y corta de lo que propuso. `place`: solo un id de lugar que exista. Fecha: inDays (0 hoy, 1 mañana…) o weekday (0 lunes a 6 domingo); hour/minute solo si se dijeron.',
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
    description: 'Anotas algo que la otra persona acaba de decirte: su nombre (kind "name", aunque sea un apodo o falso) o un dato concreto sobre sí misma (kind "fact"). `quote`: cita literal y corta de lo que dijo. Nada inferido.',
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
    description: 'Te dejas una nota privada y breve (intención o pensamiento) para tu siguiente turno. Nadie más la ve.',
    roles: ['character'], fire: true,
    params: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: text(240) } },
    handler({ claims }, { text: note }) { claims.intent = note; return { ok: true, result: { noted: true } }; }
  },
  {
    name: 'end_conversation',
    description: 'Terminas la conversación tú mismo (te vas, cuelgas, llegó a su fin). Lo que escribas en esta respuesta es tu despedida.',
    roles: ['character'], fire: true,
    params: { type: 'object', properties: { reason: text(160) }, additionalProperties: false },
    handler({ claims }, { reason = '' }) { claims.end = { reason }; return { ok: true, result: { noted: true } }; }
  }
];

// Consulta (no «dispara y olvida»): el personaje pide a su propia memoria lo que no tiene delante. Es la red de seguridad de la ficha en dos capas:
// si el motor no adelantó una entrada profunda, el personaje puede buscarla en vez de inventarla. Cuesta una vuelta extra solo cuando se usa.
characterTools.push({
  name: 'recall',
  description: 'Consultas tu propia memoria cuando necesitas un recuerdo, secreto, conexión o detalle de tu vida que no tienes delante. Indica el tema en pocas palabras.',
  kind: 'query', roles: ['character', 'text'],
  params: { type: 'object', required: ['topic'], additionalProperties: false, properties: { topic: text(120) } },
  handler({ deep = [] }, { topic }) {
    const found = selectDeep(deep, topic, { max: 3, maxChars: 900 });
    return { ok: true, result: found.length ? { recuerdos: found.map(({ section, text: texto }) => ({ seccion: section, texto })) } : { recuerdos: [], nota: 'No recuerdas nada más sobre eso.' } };
  }
});

export const characterRegistry = createRegistry(characterTools);

// Herramientas visibles según el turno: en chat solo acuerdos y datos; en la despedida no se puede «terminar» otra vez;
// compartir el contacto solo si aún no se compartió.
export function characterToolNames({ mode, canShare }) {
  if (mode === 'chat') return ['agree_plan', 'remember', 'recall'];
  return ['agree_plan', 'remember', ...(mode === 'closing' ? [] : ['recall']), 'note_to_self', ...(canShare ? ['share_contact'] : []), ...(mode === 'closing' ? [] : ['end_conversation'])];
}
