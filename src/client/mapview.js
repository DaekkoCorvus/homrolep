// Visor de mapa reutilizable (esquema v2): un lienzo infinito en METROS con paneo y zoom, conversión entre pantalla y mundo, y una capa SVG en
// coordenadas de pantalla para que quien lo use dibuje encima (capas de calco, áreas, caminos, marcadores…). Lo usan el editor de mapas (desarrollo)
// y, más adelante, la pantalla de mapa del juego y la colocación de lugares del jugador. No sabe nada de lugares ni de distritos.
//
// Mundo: x crece hacia el este, y hacia el SUR (igual que la pantalla). `k` = píxeles por metro. pantalla = mundo·k + (tx, ty).
// Eventos (vía `on`): 'view' (cambió el paneo, el zoom o el tamaño) · 'pointerdown' | 'pointermove' | 'pointerup' | 'dblclick' con
// { wx, wy, x, y, event } (wx/wy en metros, x/y en píxeles del visor). El que lo usa decide si un arrastre mueve algo o panea (`beginPan`).
//
// Gestos táctiles (móvil): PELLIZCAR con dos dedos hace zoom y mueve el mapa (el contenedor lleva `touch-action:none`); el editor también los gana.
// Con `drag: true` (el mapa del juego) un dedo o el ratón arrastran el mapa solos y un toque corto emite 'tap' { wx, wy, x, y, event };
// con `doubleTapZoom: true` un doble toque acerca. 'pinchstart' avisa a quien dibuja de que el gesto en curso (un trazo, un arrastre) se cancela.
const SVG_NS = 'http://www.w3.org/2000/svg';
const TAP_SLOP = 9;          // píxeles que puede moverse un dedo y seguir siendo un toque
const TAP_MS = 550;
const DOUBLE_TAP_MS = 320;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class MapView {
  constructor(container, { minZoom = 0.0005, maxZoom = 40, wheelStep = 1.15, drag = false, doubleTapZoom = false, maxRatio = Infinity } = {}) {
    this.container = container;
    this.minZoom = minZoom; this.maxZoom = maxZoom; this.wheelStep = wheelStep;
    this.drag = drag; this.doubleTapZoom = doubleTapZoom; this.maxRatio = maxRatio;
    this.k = 0.5; this.tx = 0; this.ty = 0;
    this.listeners = new Map();
    this.panning = null;
    this.pendingFit = null;
    this.touches = new Map();   // dedos apoyados: pointerId → { x, y }
    this.pinch = null;
    this.tapping = null;
    this.lastTap = null;
    this.flight = 0;
    container.classList.add('mv');
    container.style.touchAction = 'none';
    // Tres capas, de abajo arriba: SVG de fondo (calco, áreas), canvas (relleno generado: miles de casas y árboles) y SVG superior (caminos, lugares, asas).
    this.ground = document.createElement('canvas');   // terreno pintado: debajo de todo lo demás
    this.ground.className = 'mv-ground';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'mv-svg back');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mv-canvas';
    this.top = document.createElementNS(SVG_NS, 'svg');
    this.top.setAttribute('class', 'mv-svg');
    this.final = document.createElement('canvas');   // vista final (con postproceso): encima de todo y solo visible en ese modo
    this.final.className = 'mv-final';
    container.append(this.ground, this.svg, this.canvas, this.top, this.final);
    container.addEventListener('wheel', (event) => this.#wheel(event), { passive: false });
    container.addEventListener('pointerdown', (event) => this.#pointer('pointerdown', event));
    container.addEventListener('pointermove', (event) => this.#pointer('pointermove', event));
    container.addEventListener('pointerup', (event) => this.#pointer('pointerup', event));
    container.addEventListener('pointercancel', (event) => this.#pointer('pointercancel', event));
    container.addEventListener('dblclick', (event) => this.#pointer('dblclick', event));
    container.addEventListener('contextmenu', (event) => event.preventDefault());
    new ResizeObserver(() => { if (this.pendingFit) this.fitBounds(this.pendingFit); else this.#emit('view'); }).observe(container);
  }

  on(name, handler) { (this.listeners.get(name) ?? this.listeners.set(name, []).get(name)).push(handler); return this; }
  #emit(name, payload) { for (const handler of this.listeners.get(name) ?? []) handler(payload); }

  get rect() { return this.container.getBoundingClientRect(); }

  // Encaja una caja { minX, minY, maxX, maxY } (metros) en el visor. Si el visor aún no tiene tamaño, lo hace en cuanto lo tenga.
  fitBounds(box, margin = 0.92) {
    const { width, height } = this.rect;
    if (!box) return;
    if (!width || !height) { this.pendingFit = box; return; }
    this.pendingFit = null;
    const w = Math.max(box.maxX - box.minX, 1); const h = Math.max(box.maxY - box.minY, 1);
    this.k = Math.min(this.maxZoom, Math.max(this.minZoom, Math.min(width / w, height / h) * margin));
    this.tx = width / 2 - ((box.minX + box.maxX) / 2) * this.k;
    this.ty = height / 2 - ((box.minY + box.maxY) / 2) * this.k;
    this.#emit('view');
  }

  // Mundo ↔ pantalla.
  toScreen(wx, wy) { return { x: wx * this.k + this.tx, y: wy * this.k + this.ty }; }
  toWorld(x, y) { return { wx: (x - this.tx) / this.k, wy: (y - this.ty) / this.k }; }
  // Caja visible, en metros.
  get worldBounds() {
    const { width, height } = this.rect; const a = this.toWorld(0, 0); const b = this.toWorld(width, height);
    return { minX: a.wx, minY: a.wy, maxX: b.wx, maxY: b.wy };
  }

  zoomAt(x, y, factor) {
    const k = Math.min(this.maxZoom, Math.max(this.minZoom, this.k * factor));
    const ratio = k / this.k;
    this.tx = x - (x - this.tx) * ratio; this.ty = y - (y - this.ty) * ratio; this.k = k;
    this.pendingFit = null; this.flight++;
    this.#emit('view');
  }
  panBy(dx, dy) { this.tx += dx; this.ty += dy; this.pendingFit = null; this.flight++; this.#emit('view'); }
  // Centra la vista en un punto del mundo (sin cambiar el zoom).
  centerOn(wx, wy) {
    const { width, height } = this.rect; const p = this.toScreen(wx, wy);
    this.panBy(width / 2 - p.x, height / 2 - p.y);
  }

  #wheel(event) {
    event.preventDefault();
    const { left, top } = this.rect;
    this.zoomAt(event.clientX - left, event.clientY - top, event.deltaY < 0 ? this.wheelStep : 1 / this.wheelStep);
  }

  // Quien usa el visor llama a esto desde 'pointerdown' cuando el arrastre debe mover el mapa.
  beginPan(event) { this.panning = { x: event.clientX, y: event.clientY }; this.container.setPointerCapture?.(event.pointerId); this.container.classList.add('panning'); }

  #point(event) { const { left, top } = this.rect; return { x: event.clientX - left, y: event.clientY - top }; }

  // Pellizco: el punto del mundo que estaba bajo el centro de los dos dedos sigue bajo él, y la distancia entre dedos manda el zoom.
  #pinchMove() {
    const [a, b] = [...this.touches.values()];
    const distance = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
    const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
    const wx = (this.pinch.cx - this.tx) / this.k; const wy = (this.pinch.cy - this.ty) / this.k;
    const k = Math.min(this.maxZoom, Math.max(this.minZoom, this.k * (distance / this.pinch.distance)));
    this.k = k; this.tx = cx - wx * k; this.ty = cy - wy * k;
    this.pinch = { distance, cx, cy };
    this.pendingFit = null; this.flight++;
    this.#emit('view');
  }

  #pointer(type, event) {
    const touch = event.pointerType === 'touch';
    const { x, y } = this.#point(event);
    if (touch) {
      if (type === 'pointerdown') {
        this.touches.set(event.pointerId, { x, y });
        if (this.touches.size === 2) {                       // empieza un pellizco: se cancela lo que hiciera el primer dedo
          this.panning = null; this.tapping = null; this.lastTap = null; this.container.classList.remove('panning');
          const [a, b] = [...this.touches.values()];
          this.pinch = { distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
          this.#emit('pinchstart');
          return;
        }
      } else if (this.touches.has(event.pointerId)) {
        if (type === 'pointermove') this.touches.set(event.pointerId, { x, y });
        if (type === 'pointerup' || type === 'pointercancel') this.touches.delete(event.pointerId);
      }
      if (this.pinch) {
        if (type === 'pointermove' && this.touches.size >= 2) this.#pinchMove();
        if (this.touches.size < 2 && (type === 'pointerup' || type === 'pointercancel')) {
          this.pinch = null;
          const rest = [...this.touches.values()][0];      // si queda un dedo, sigue arrastrando desde donde está
          if (rest && this.drag) { this.panning = { x: rest.x + this.rect.left, y: rest.y + this.rect.top }; this.container.classList.add('panning'); }
        }
        return;
      }
    }
    if (type === 'pointerdown' && this.drag && (touch || event.button === 0)) {
      this.tapping = { id: event.pointerId, x, y, t: performance.now(), moved: false };
      this.beginPan(event);
    }
    if (type === 'pointermove' && this.tapping && Math.hypot(x - this.tapping.x, y - this.tapping.y) > TAP_SLOP) this.tapping.moved = true;
    if (type === 'pointermove' && this.panning) {
      this.panBy(event.clientX - this.panning.x, event.clientY - this.panning.y);
      this.panning = { x: event.clientX, y: event.clientY };
      return;
    }
    if ((type === 'pointerup' || type === 'pointercancel') && this.panning) {
      this.panning = null; this.container.classList.remove('panning'); this.container.releasePointerCapture?.(event.pointerId);
      const tap = this.tapping; this.tapping = null;
      if (type === 'pointerup' && tap && tap.id === event.pointerId && !tap.moved && performance.now() - tap.t < TAP_MS) this.#tap(x, y, event);
      return;
    }
    if (type === 'pointercancel') return;
    this.#emit(type, { ...this.toWorld(x, y), x, y, event });
  }

  #tap(x, y, event) {
    const payload = { ...this.toWorld(x, y), x, y, event };
    const now = performance.now(); const last = this.lastTap;
    if (this.doubleTapZoom && last && now - last.t < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < 32) {
      this.lastTap = null;
      this.#emit('doubletap', payload);
      this.zoomTo(x, y, 2.2);
      return;
    }
    this.lastTap = { x, y, t: now };
    this.#emit('tap', payload);
  }

  // Zoom suave hacia un punto de pantalla (doble toque, botones). Sin animación si el sistema pide menos movimiento.
  zoomTo(x, y, factor, ms = 260) {
    const k = Math.min(this.maxZoom, Math.max(this.minZoom, this.k * factor)); const ratio = k / this.k;
    this.flyTo({ k, tx: x - (x - this.tx) * ratio, ty: y - (y - this.ty) * ratio }, ms);
  }

  // Lleva la vista a { k, tx, ty } con una transición corta (o de golpe con `reduced-motion`). Cualquier gesto del usuario la interrumpe.
  flyTo(target, ms = 420) {
    const token = ++this.flight; this.pendingFit = null;
    const k = Math.min(this.maxZoom, Math.max(this.minZoom, target.k));
    if (reduced() || ms <= 0) { Object.assign(this, { k, tx: target.tx, ty: target.ty }); this.#emit('view'); return Promise.resolve(); }
    const from = { k: this.k, tx: this.tx, ty: this.ty }; const start = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (token !== this.flight) { resolve(); return; }
        const t = Math.min(1, (now - start) / ms); const e = 1 - (1 - t) ** 3;
        // el zoom se interpola en escala logarítmica: acercar y alejar se sienten igual de rápidos
        this.k = from.k * (k / from.k) ** e; this.tx = from.tx + (target.tx - from.tx) * e; this.ty = from.ty + (target.ty - from.ty) * e;
        this.#emit('view');
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // Encuadre que deja el punto del mundo (wx, wy) en el centro del visor con `k` píxeles por metro.
  frameAt(wx, wy, k = this.k) { const { width, height } = this.rect; return { k, tx: width / 2 - wx * k, ty: height / 2 - wy * k }; }

  // Igual que beginCanvas pero para la capa del terreno (la de más abajo).
  beginGround() {
    const { width, height } = this.rect; const ratio = Math.min(window.devicePixelRatio || 1, this.maxRatio);
    const w = Math.round(width * ratio); const h = Math.round(height * ratio);
    if (this.ground.width !== w || this.ground.height !== h) { this.ground.width = w; this.ground.height = h; }
    const ctx = this.ground.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  // Prepara el canvas (tamaño de pantalla con densidad de píxeles) y lo devuelve limpio, con coordenadas en píxeles CSS.
  beginCanvas() {
    const { width, height } = this.rect; const ratio = Math.min(window.devicePixelRatio || 1, this.maxRatio);
    const w = Math.round(width * ratio); const h = Math.round(height * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  // Las capas SVG (en coordenadas de pantalla) se vacían y se pintan de nuevo cada vez que cambia algo.
  clearLayer() { this.svg.replaceChildren(); this.top.replaceChildren(); }
  svgElement(name, attributes = {}, parent = this.svg) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    parent.append(node);
    return node;
  }
}
