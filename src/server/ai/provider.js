export async function interpretPlayerAction({ text }) {
  return { provider: 'mock', text, narrative: 'La ciudad toma nota. Algo puede cambiar a partir de esta decisión.' };
}

function localPrologue(player, worldData) {
  const story = player.origin.toLocaleLowerCase('es');
  const hints = [
    ['station', /viaj|tren|estaci[oó]n|lleg|huir|escap/],
    ['park', /naturaleza|bosque|parque|silencio|calma/],
    ['cafe', /caf[eé]|convers|gente|amig|rumor/],
    ['store', /tienda|compr|vend|comerc|negoci/]
  ];
  const suggested = hints.find(([, pattern]) => pattern.test(story))?.[0] ?? 'apartment';
  const location = worldData.locations.find(({ id }) => id === suggested) ?? worldData.locations[0];
  const identity = player.gender === 'man' ? 'hombre' : player.gender === 'woman' ? 'mujer' : player.genderCustom;
  const history = player.origin.replace(/\s+/g, ' ').slice(0, 240).replace(/[.!?]+$/, '');
  return {
    source: 'local', locationId: location.id,
    text: `${player.name}, tienes ${player.age} años, eres de raza humana y te reconoces como ${identity}. Llegas a ${location.name} con una historia que solo tú conoces por completo: ${history}. Northfortress se abre ante ti; lo que serás aquí todavía no está escrito.`
  };
}

async function aiPrologue(player, worldData) {
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env;
  if (process.env.AI_PROVIDER !== 'openai-compatible' || !AI_BASE_URL || !AI_API_KEY || !AI_MODEL) return null;
  const endpoint = new URL('chat/completions', AI_BASE_URL.endsWith('/') ? AI_BASE_URL : `${AI_BASE_URL}/`);
  const places = worldData.locations.map(({ id, name, district }) => ({ id, name, district }));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL, temperature: 0.7,
      messages: [
        { role: 'system', content: 'Eres una entidad misteriosa que recibe a un personaje en Northfortress. Escribe en español un prólogo de 2 a 4 frases, evocador y personal, en segunda persona. Usa la historia y la identidad del personaje sin estereotipos. No decidas su ocupación ni su aspiración y no inventes canon oficial, reglas, dinero ni hechos que contradigan los datos. Elige solo una ubicación de la lista. Responde únicamente JSON con {"text":"...","locationId":"..."}.' },
        { role: 'user', content: JSON.stringify({ player: { name: player.name, age: player.age, gender: player.gender === 'custom' ? player.genderCustom : player.gender, race: player.race, history: player.origin }, locations: places }) }
      ]
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`El proveedor de IA respondió ${response.status}.`);
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('La IA no devolvió un prólogo válido.');
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  if (typeof parsed.text !== 'string' || !parsed.text.trim() || typeof parsed.locationId !== 'string') throw new Error('La IA no devolvió los campos esperados.');
  if (!worldData.locations.some(({ id }) => id === parsed.locationId)) throw new Error('La IA propuso una ubicación fuera del mapa.');
  return { source: 'ai', text: parsed.text, locationId: parsed.locationId };
}

export async function generatePrologue(player, worldData) {
  try {
    return await aiPrologue(player, worldData) ?? localPrologue(player, worldData);
  } catch (error) {
    console.warn(`Prólogo local: ${error.message}`);
    return localPrologue(player, worldData);
  }
}
