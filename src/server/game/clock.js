const DAY_MINUTES = 24 * 60;

export function advanceTime(world, minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) throw new Error('Los minutos deben ser un entero positivo.');
  const total = world.hour * 60 + world.minute + minutes;
  return {
    ...world,
    day: world.day + Math.floor(total / DAY_MINUTES),
    hour: Math.floor((total % DAY_MINUTES) / 60),
    minute: total % 60
  };
}

export function timeKey(world) {
  return `DAY_${world.day}_${String(world.hour).padStart(2, '0')}:${String(world.minute).padStart(2, '0')}`;
}

export function dayPeriod(hour) {
  if (hour < 4) return 'Medianoche';
  if (hour < 6) return 'Madrugada';
  if (hour < 8) return 'Amanecer';
  if (hour < 12) return 'Mañana';
  if (hour < 14) return 'Mediodía';
  if (hour < 18) return 'Tarde';
  if (hour < 21) return 'Atardecer';
  return 'Noche';
}
