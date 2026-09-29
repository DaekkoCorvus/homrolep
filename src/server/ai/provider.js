export async function interpretPlayerAction({ text }) {
  return { provider: 'mock', text, narrative: 'La ciudad toma nota. Algo puede cambiar a partir de esta decisión.' };
}
