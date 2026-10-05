// Escenas procedurales de Porta Magna: SVG + CSS animados que reaccionan a la hora del mundo.
// Son presentación, no canon. Cada escena puede sustituirse después por arte propio
// (`art`: imagen/video de fondo) y declarar una capa sonora (`ambient`) sin tocar el motor.

const KEYFRAMES = [
  [0,  '#070b1c', '#18213f'], [4.5, '#0d1230', '#2a2c58'], [6,   '#3b4a86', '#d88f7b'],
  [7.5,'#5b86c4', '#f4c08e'], [10,  '#5aa2e2', '#cfe8f7'], [15,  '#4f97dc', '#c2e2f4'],
  [17.5,'#5b7fb8','#f2c48c'], [19,  '#3b3a7a', '#e5806a'], [20.5,'#151a45', '#4a3f78'],
  [24, '#070b1c', '#18213f']
];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',')})`;

export function skyFor(world) {
  const h = world.hour + world.minute / 60;
  let i = KEYFRAMES.findIndex(([at]) => at > h) - 1;
  if (i < 0) i = KEYFRAMES.length - 2;
  const [h0, a0, b0] = KEYFRAMES[i]; const [h1, a1, b1] = KEYFRAMES[i + 1];
  const t = (h - h0) / (h1 - h0);
  const night = h < 5 || h >= 20.5 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h >= 18 ? (h - 18) / 2.5 : 0;
  const daySpan = (h - 6) / 12;
  const dayBody = h >= 6 && h < 18;
  const t2 = dayBody ? daySpan : ((h >= 18 ? h - 18 : h + 6) / 12);
  return {
    a: mix(a0, a1, t), b: mix(b0, b1, t), night: Math.max(0, Math.min(1, night)),
    body: { day: dayBody, x: 50 + 300 * Math.min(1, Math.max(0, t2)), y: 250 - 190 * Math.sin(Math.PI * Math.min(1, Math.max(0, t2))) }
  };
}

function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

function skyline({ seed, y, minH, maxH, fill, count = 13, lit = true, alpha = 1 }) {
  const r = rng(seed); let x = -24; let out = '';
  while (x < 420) {
    const w = 28 + r() * 26; const h = minH + r() * (maxH - minH); const top = y - h;
    out += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`;
    if (r() > .55) out += `<rect x="${(x + w / 2 - 1).toFixed(1)}" y="${(top - 14).toFixed(1)}" width="2" height="14" fill="${fill}"/>`;
    if (lit) {
      for (let wy = top + 8; wy < y - 8; wy += 9) for (let wx = x + 5; wx < x + w - 6; wx += 8) {
        const p = r();
        if (p > .58) out += `<rect class="win" x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="3.4" height="4.4" fill="${p > .9 ? '#9fd8ff' : '#ffd98a'}" style="opacity:calc(var(--night) * ${(.55 + r() * .45).toFixed(2)})"/>`;
      }
    }
    x += w + r() * 3;
  }
  return `<g opacity="${alpha}">${out}</g>`;
}

// Los degradados SVG no se reevalúan al cambiar variables CSS: el cielo va con fills planos (o CSS en el fondo).
const skyRect = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" style="fill:var(--sky-b)"/><rect x="${x}" y="${y}" width="${w}" height="${h * .55}" style="fill:var(--sky-a);filter:blur(${h * .08}px)"/>`;

function sky(world) {
  const { body } = skyFor(world); const r = rng(11); let stars = '';
  for (let i = 0; i < 46; i++) stars += `<circle class="star" cx="${(r() * 400).toFixed(0)}" cy="${(r() * 300).toFixed(0)}" r="${(0.5 + r() * 1.1).toFixed(1)}" style="animation-delay:${(r() * 5).toFixed(1)}s"/>`;
  return `
    <g class="stars" style="opacity:var(--night)" fill="#fff">${stars}</g>
    <g class="body" style="transform:translate(${body.x}px,${body.y}px)">
      ${body.day ? '<circle r="46" fill="#fff6d8" opacity=".22"/><circle r="22" fill="#fff3c4"/>' : '<circle r="40" fill="#cfe0ff" opacity=".13"/><circle r="17" fill="#e9f0ff"/><circle cx="6" cy="-4" r="15" style="fill:var(--sky-a)" opacity=".55"/>'}
    </g>
    <g class="clouds" opacity=".5">
      <g class="cloud c1"><ellipse cx="90" cy="120" rx="52" ry="12" fill="#fff" opacity=".35"/><ellipse cx="120" cy="112" rx="34" ry="10" fill="#fff" opacity=".3"/></g>
      <g class="cloud c2"><ellipse cx="300" cy="190" rx="60" ry="13" fill="#fff" opacity=".28"/><ellipse cx="270" cy="182" rx="30" ry="9" fill="#fff" opacity=".26"/></g>
    </g>`;
}

const defs = `
  <defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky-a)"/><stop offset=".62" style="stop-color:var(--sky-b)"/></linearGradient>
    <radialGradient id="lampGlow"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".85"/><stop offset="1" stop-color="#ffb05a" stop-opacity="0"/></radialGradient>
    <radialGradient id="coolGlow"><stop offset="0" stop-color="#bfe6ff" stop-opacity=".7"/><stop offset="1" stop-color="#7fc1ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
  </defs>`;

const lamp = (x, y, s = 1, cool = false) => `<g transform="translate(${x} ${y}) scale(${s})"><circle class="glow" r="46" fill="url(#${cool ? 'coolGlow' : 'lampGlow'})" style="opacity:calc(.35 + var(--night) * .65)"/><circle r="3.2" fill="${cool ? '#e6f6ff' : '#fff1c8'}"/></g>`;

const SCENES = {
  station(world) {
    let ribs = ''; for (let i = -1; i < 6; i++) ribs += `<path d="M${i * 80} 0 Q${i * 80 + 40} 150 ${i * 80 + 80} 0" fill="none" stroke="#0b0f1f" stroke-width="5" opacity=".75"/>`;
    return `${sky(world)}
      <g class="far">${skyline({ seed: 5, y: 430, minH: 60, maxH: 170, fill: '#161d3a', alpha: .75 })}</g>
      <g class="near">${skyline({ seed: 9, y: 450, minH: 40, maxH: 110, fill: '#0e1428' })}</g>
      <rect y="0" width="400" height="86" fill="#0a0e1c" opacity=".85"/>${ribs}
      <path d="M0 86 H400" stroke="#1d2547" stroke-width="3"/>
      <g class="beams" style="opacity:calc(.25 + var(--night)*.55)"><path d="M70 90 L20 470 H130Z" fill="url(#coolGlow)" opacity=".28"/><path d="M330 90 L270 470 H390Z" fill="url(#coolGlow)" opacity=".28"/></g>
      <g class="sign-wrap" transform="translate(200 128)"><rect x="-118" y="-26" width="236" height="46" rx="4" fill="#0b1226" stroke="#7fa4d8" stroke-opacity=".55"/><text class="sign" x="0" y="6" text-anchor="middle" font-family="Georgia,serif" font-size="19" letter-spacing="3" fill="#dcecff">PORTA MAGNA</text><path d="M-90 -26 V-70 M90 -26 V-70" stroke="#2b3559" stroke-width="2"/></g>
      <g class="train-wrap"><g class="train">${[0, 1, 2, 3, 4, 5].map((i) => `<g transform="translate(${i * 128} 0)"><rect y="366" width="122" height="66" rx="9" fill="#232c4c"/><rect y="366" width="122" height="7" rx="3" fill="#7d95d0" opacity=".5"/>${[0, 1, 2, 3].map((k) => `<rect x="${10 + k * 28}" y="380" width="20" height="24" rx="3" fill="#ffe3a0" opacity=".9"/>`).join('')}</g>`).join('')}</g></g>
      <rect y="432" width="400" height="368" fill="#111830"/>
      <rect y="432" width="400" height="9" fill="#e8c86a" opacity=".55"/>
      <path d="M0 470 H400 M0 496 H400 M0 530 H400" stroke="#2a3557" stroke-width="1.4" opacity=".7"/>
      <g stroke="#1f2a4a" stroke-width="2" opacity=".9">${[-20, 60, 140, 220, 300, 380].map((x) => `<path d="M${x} 440 L${x - 30} 800"/>`).join('')}</g>
      ${[70, 330].map((x) => `<g><rect x="${x - 5}" y="200" width="10" height="240" fill="#0c1124"/>${lamp(x, 204, 1.1, true)}</g>`).join('')}
      <rect width="400" height="800" fill="url(#floorFade)" opacity=".5"/>`;
  },

  apartment(world) {
    return `${sky(world)}
      <rect width="400" height="800" fill="#141322"/>
      <rect x="0" y="0" width="400" height="500" fill="#1d1b30"/>
      <g><rect x="88" y="96" width="224" height="264" fill="#0a0d1e"/>
        <clipPath id="win"><rect x="94" y="102" width="212" height="252"/></clipPath>
        <g clip-path="url(#win)"><g transform="translate(-40 60) scale(1.5)">${skyRect(0,0,400,400)}${skyline({ seed: 21, y: 240, minH: 40, maxH: 130, fill: '#1a2246' })}${skyline({ seed: 33, y: 260, minH: 30, maxH: 80, fill: '#0f1530' })}</g>
        <rect x="94" y="102" width="212" height="252" fill="url(#coolGlow)" opacity=".08"/></g>
        <path d="M200 96 V360 M88 228 H312" stroke="#2a2d4d" stroke-width="5"/><rect x="82" y="360" width="236" height="12" fill="#2b2e50"/></g>
      <path class="curtain l" d="M88 90 Q118 230 92 372 L60 372 L60 90Z" fill="#3a2f55"/><path class="curtain r" d="M312 90 Q282 230 308 372 L340 372 L340 90Z" fill="#3a2f55"/>
      <rect y="500" width="400" height="300" fill="#100f1c"/><rect y="500" width="400" height="6" fill="#2b2846"/>
      <g><rect x="18" y="438" width="150" height="70" rx="6" fill="#2a2448"/><rect x="18" y="418" width="150" height="34" rx="14" fill="#41396a"/><rect x="26" y="426" width="56" height="22" rx="10" fill="#5a4f88"/></g>
      <g><rect x="292" y="446" width="92" height="12" fill="#2a2448"/><rect x="300" y="458" width="6" height="52" fill="#221d3c"/><rect x="370" y="458" width="6" height="52" fill="#221d3c"/><path d="M330 446 V410 L350 392" stroke="#8a86b8" stroke-width="3" fill="none"/>${lamp(352, 390, 1.6)}</g>
      <rect x="40" y="112" width="34" height="46" fill="#292447"/><rect x="46" y="119" width="22" height="32" fill="#4c4478"/>
      <rect width="400" height="800" fill="url(#floorFade)" opacity=".45"/>`;
  },

  cafe(world) {
    return `<rect width="400" height="800" fill="#241612"/>
      <rect y="0" width="400" height="520" fill="#33201a"/>
      <g opacity=".5">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<rect x="${i * 50}" y="0" width="2" height="520" fill="#1c100c"/>`).join('')}</g>
      <g><rect x="230" y="120" width="140" height="210" fill="#0b0e20"/><clipPath id="cw"><rect x="234" y="124" width="132" height="202"/></clipPath>
        <g clip-path="url(#cw)"><g transform="translate(-60 20) scale(1.2)">${skyRect(0,0,400,400)}${skyline({ seed: 44, y: 240, minH: 40, maxH: 120, fill: '#1a2246' })}</g></g>
        <path d="M300 120 V330 M230 225 H370" stroke="#4a2f22" stroke-width="5"/></g>
      <g class="sign-wrap"><rect x="30" y="110" width="150" height="90" rx="4" fill="#1b100d" stroke="#6d4a35"/><text x="105" y="145" text-anchor="middle" font-family="Georgia,serif" font-size="17" fill="#f1d9b0">Luna's Coffee</text><text x="105" y="172" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#c2a07a" opacity=".85">café · té · pan · dulces</text></g>
      ${[70, 175, 330].map((x, i) => `<g class="pendant" style="animation-delay:${i * .9}s"><path d="M${x} 0 V${64 + i * 6}" stroke="#12090a" stroke-width="2"/>${lamp(x, 78 + i * 6, 1.15)}<path d="M${x - 15} ${82 + i * 6} Q${x} ${62 + i * 6} ${x + 15} ${82 + i * 6}Z" fill="#c98f4c"/></g>`).join('')}
      <rect y="440" width="400" height="360" fill="#2a1a13"/>
      <rect y="400" width="400" height="60" fill="#4a2f22"/><rect y="400" width="400" height="7" fill="#7a5238"/>
      <g><rect x="40" y="374" width="34" height="28" rx="4" fill="#e9d9c0"/><rect x="120" y="372" width="30" height="30" rx="4" fill="#d8c5a8"/>
        <path class="steam" d="M52 368 q-6 -14 0 -24 q6 -10 0 -22" stroke="#fff" stroke-opacity=".5" fill="none" stroke-width="3" stroke-linecap="round"/>
        <path class="steam s2" d="M133 366 q-6 -14 0 -24 q6 -10 0 -22" stroke="#fff" stroke-opacity=".45" fill="none" stroke-width="3" stroke-linecap="round"/>
        <rect x="200" y="350" width="70" height="52" rx="5" fill="#1a0f0b"/><circle cx="235" cy="376" r="15" fill="#5a3a2a"/><circle cx="235" cy="376" r="6" fill="#241612"/></g>
      ${[90, 300].map((x) => `<g><circle cx="${x}" cy="560" r="34" fill="#4a2f22"/><rect x="${x - 3}" y="560" width="6" height="90" fill="#30190f"/><ellipse cx="${x}" cy="650" rx="30" ry="6" fill="#1a0f0b"/></g>`).join('')}
      <rect width="400" height="800" fill="url(#floorFade)" opacity=".5"/>`;
  },

  park(world) {
    const r = rng(77); let trees = '';
    for (const [x, y, s] of [[40, 470, 1.3], [345, 465, 1.25], [190, 448, .8], [120, 452, .75], [280, 452, .8]]) {
      trees += `<g transform="translate(${x} ${y}) scale(${s})"><g class="tree" style="animation-delay:${(r() * 3).toFixed(1)}s"><rect x="-6" y="-70" width="12" height="70" fill="#24140f"/><circle cx="0" cy="-120" r="48" fill="#1d3b2f"/><circle cx="-30" cy="-98" r="34" fill="#22493a"/><circle cx="32" cy="-100" r="36" fill="#1a3629"/><circle cx="4" cy="-150" r="28" fill="#2a5a45"/></g></g>`;
    }
    let flies = ''; for (let i = 0; i < 12; i++) flies += `<circle class="firefly" cx="${(r() * 380 + 10).toFixed(0)}" cy="${(380 + r() * 130).toFixed(0)}" r="1.9" fill="#f6ff9a" style="animation-delay:${(r() * 6).toFixed(1)}s"/>`;
    return `${sky(world)}
      <g class="far">${skyline({ seed: 61, y: 420, minH: 50, maxH: 150, fill: '#161d3a', alpha: .6 })}</g>
      <path d="M0 430 Q120 380 220 420 T400 400 V800 H0Z" fill="#1e3a30"/>
      <path d="M0 470 Q140 430 260 462 T400 450 V800 H0Z" fill="#183226"/>
      <path d="M150 800 Q190 560 230 470 L262 470 Q250 600 340 800Z" fill="#b9a67a" opacity=".22"/>
      ${trees}
      <g><rect x="255" y="500" width="90" height="8" fill="#5a3b26"/><rect x="255" y="482" width="90" height="6" fill="#5a3b26"/><rect x="262" y="508" width="5" height="22" fill="#2a190f"/><rect x="333" y="508" width="5" height="22" fill="#2a190f"/></g>
      <g><rect x="70" y="330" width="6" height="170" fill="#151824"/>${lamp(73, 330, 1.2)}</g>
      <g class="flies" style="opacity:var(--night)">${flies}</g>
      <rect y="500" width="400" height="300" fill="#13271f"/>
      <rect width="400" height="800" fill="url(#floorFade)" opacity=".4"/>`;
  },

  store(world) {
    return `${sky(world)}
      <g class="far">${skyline({ seed: 88, y: 330, minH: 40, maxH: 110, fill: '#151c38', alpha: .7 })}</g>
      <rect x="10" y="150" width="380" height="330" fill="#1c2340"/>
      <rect x="10" y="150" width="380" height="18" fill="#12172e"/>
      <rect class="sign-wrap" x="40" y="90" width="320" height="56" rx="6" fill="#0a0d1c" stroke="#8fd9ff" stroke-opacity=".6"/>
      <text class="neon sign-wrap" x="200" y="128" text-anchor="middle" font-family="Georgia,serif" font-size="30" letter-spacing="8" fill="#9fe6ff">TIENDA</text>
      <path d="M22 168 H378 L390 218 H10Z" fill="#8c3b4a"/><path d="M22 168 H378 L384 190 H16Z" fill="#a34556"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M${10 + i * 54} 218 q27 16 54 0" fill="#f2e4d0" opacity=".85"/>`).join('')}
      <rect x="34" y="236" width="222" height="212" fill="#f7deb0" opacity=".9"/>
      <rect x="34" y="236" width="222" height="212" fill="url(#lampGlow)" opacity=".5"/>
      ${[0, 1, 2].map((i) => `<rect x="44" y="${268 + i * 56}" width="202" height="6" fill="#4a3526"/>${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${52 + k * 32}" y="${244 + i * 56}" width="22" height="${24}" rx="3" fill="${['#d9534f', '#5bc0de', '#f0ad4e', '#5cb85c', '#a78bfa', '#f472b6'][(k + i) % 6]}" opacity=".85"/>`).join('')}`).join('')}
      <rect x="280" y="236" width="84" height="212" rx="4" fill="#12172e"/><rect x="290" y="246" width="64" height="190" fill="#e8f0ff" opacity=".12"/><circle cx="296" cy="344" r="3" fill="#ffd98a"/>
      <rect y="480" width="400" height="320" fill="#161c34"/><rect y="480" width="400" height="8" fill="#3a4470" opacity=".7"/>
      <ellipse cx="150" cy="560" rx="80" ry="10" fill="#7fc1ff" opacity=".13"/>
      <g><rect x="365" y="290" width="8" height="190" fill="#0c1024"/>${lamp(369, 288, 1.3, true)}</g>
      <rect width="400" height="800" fill="url(#floorFade)" opacity=".5"/>`;
  }
};

export const SCENE_META = {
  station:   { label:'Andén principal', interactions:['Mirar el tablero de horarios', 'Observar a los viajeros', 'Sentarme en un banco'], ambient:null },
  apartment: { label:'Tu cuarto', interactions:['Asomarme a la ventana', 'Ordenar mis cosas', 'Revisar el escritorio'], ambient:null },
  cafe:      { label:'Barra de la cafetería', interactions:['Pedir algo de beber', 'Escuchar las conversaciones', 'Sentarme junto a la ventana'], ambient:null },
  park:      { label:'Sendero del parque', interactions:['Pasear entre los árboles', 'Sentarme en una banca', 'Mirar el cielo'], ambient:null },
  store:     { label:'Pasillos de la tienda', interactions:['Mirar los productos', 'Hablar con el dependiente'], ambient:null }
};

// El mapa manda: un lugar nuevo del editor sin arte propio usa la escena genérica de su tipo (casa, comida, tienda, transporte, exterior).
const SCENE_BY_KIND = { home: 'apartment', food: 'cafe', shop: 'store', transport: 'station', gateway: 'station', poi: 'park', other: 'park' };
export const sceneFor = (loc) => (SCENES[loc?.id] ? loc.id : SCENE_BY_KIND[loc?.kind] ?? 'station');

export function sceneMarkup(sceneKey, world) {
  const build = SCENES[sceneKey] ?? SCENES.station;
  return `<svg class="scene-svg" viewBox="0 0 400 800" preserveAspectRatio="xMidYMin slice" aria-hidden="true">${defs}${build(world)}</svg>`;
}

export function applySky(element, world) {
  const { a, b, night } = skyFor(world);
  element.style.setProperty('--sky-a', a);
  element.style.setProperty('--sky-b', b);
  element.style.setProperty('--night', night.toFixed(3));
}
