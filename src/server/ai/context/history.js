// Ventana de conversación (broker de contexto, Fase 4): al personaje solo se le reenvían las últimas intervenciones. Lo importante de lo anterior
// ya no vive en la transcripción: los datos y acuerdos los anota el propio personaje con sus herramientas (Fase 3), las impresiones y el resumen
// los guarda la reflexión del GM al cerrar, y todo eso vuelve en «recuerdos», «pendientes» y «lo que sabes». La reflexión del GM sí recibe la
// transcripción completa (necesita las citas literales).
export function windowOf(lines, size) {
  if (lines.length <= size) return { lines, omitted: 0 };
  return { lines: lines.slice(-size), omitted: lines.length - size };
}
