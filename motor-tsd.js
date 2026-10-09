/*
 * Motor de reglas de The Stifling Dark — turno del Adversario.
 *
 * Este módulo sabe qué es legal y qué consecuencias tiene, y nada más.
 * No decide jugadas: de eso se encargará la IA más adelante.
 *
 * Todo lo que el Adversario tendría que decir en voz alta sale en `anuncios`.
 * Lo que debe quedar oculto no se anuncia nunca.
 */
(function (raiz) {
"use strict";

// ─────────────────────────────────────────────── geometría

function distanciaPunto(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  let t = L ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
function cruzan(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
function cortaCirculo(p1, p2, cx, cy, r) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], A = dx * dx + dy * dy;
  if (A < 1e-9) return false;
  let t = -((p1[0] - cx) * dx + (p1[1] - cy) * dy) / A;
  t = Math.max(0, Math.min(1, t));
  const px = p1[0] + t * dx - cx, py = p1[1] + t * dy - cy;
  return px * px + py * py < r * r;
}
function dentroDe(obst, p) {
  if (!obst.closed || obst.points.length < 3) return false;
  const pts = obst.points;
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// ─────────────────────────────────────────────── mapa

function prepararMapa(datos) {
  const mapa = {
    radio: datos.nodeRadius || 30,
    casillas: new Map(),
    vecinas: new Map(),      // id -> [{id, tipo}]
    obstaculos: datos.obstacles || [],
    zonas: new Set(),
  };
  for (const n of datos.nodes) {
    mapa.casillas.set(n.id, n);
    mapa.vecinas.set(n.id, []);
    if (n.zone) mapa.zonas.add(n.zone);
  }
  for (const e of datos.edges || []) {
    if (!mapa.casillas.has(e.a) || !mapa.casillas.has(e.b)) continue;
    mapa.vecinas.get(e.a).push({ id: e.b, tipo: e.type });
    mapa.vecinas.get(e.b).push({ id: e.a, tipo: e.type });
  }
  mapa.segmentosFijos = segmentosDe(mapa.obstaculos, () => true);
  mapa.rejilla = indexar(mapa.segmentosFijos, 160);
  return mapa;
}
// índice espacial: solo miramos los obstáculos que caen cerca de la línea
function indexar(segs, lado) {
  const celdas = new Map();
  const mete = (cx, cy, i) => {
    const k = cx + "," + cy;
    if (!celdas.has(k)) celdas.set(k, []);
    celdas.get(k).push(i);
  };
  segs.forEach((s, i) => {
    const x0 = Math.min(s[0][0], s[1][0]), x1 = Math.max(s[0][0], s[1][0]);
    const y0 = Math.min(s[0][1], s[1][1]), y1 = Math.max(s[0][1], s[1][1]);
    for (let cx = Math.floor(x0 / lado); cx <= Math.floor(x1 / lado); cx++)
      for (let cy = Math.floor(y0 / lado); cy <= Math.floor(y1 / lado); cy++) mete(cx, cy, i);
  });
  return { lado, celdas };
}
function cercanos(mapa, a, b, margen) {
  const { lado, celdas } = mapa.rejilla;
  const x0 = Math.min(a.x, b.x) - margen, x1 = Math.max(a.x, b.x) + margen;
  const y0 = Math.min(a.y, b.y) - margen, y1 = Math.max(a.y, b.y) + margen;
  const vistos = new Set();
  for (let cx = Math.floor(x0 / lado); cx <= Math.floor(x1 / lado); cx++)
    for (let cy = Math.floor(y0 / lado); cy <= Math.floor(y1 / lado); cy++) {
      const lista = celdas.get(cx + "," + cy);
      if (lista) for (const i of lista) vistos.add(i);
    }
  const out = [];
  for (const i of vistos) out.push(mapa.segmentosFijos[i]);
  return out;
}
function segmentosDe(obstaculos, filtro) {
  const segs = [];
  for (const o of obstaculos) {
    if (!filtro(o)) continue;
    const p = o.points;
    for (let i = 0; i < p.length - 1; i++) segs.push([p[i], p[i + 1]]);
    if (o.closed && p.length > 2) segs.push([p[p.length - 1], p[0]]);
  }
  return segs;
}

// ─────────────────────────────────────────────── línea de visión

function esquinasCerca(a, b, segs, radio) {
  const out = [], ancho = radio * 5, vistas = new Set();
  const vx = b.x - a.x, vy = b.y - a.y, L = Math.hypot(vx, vy) || 1;
  for (const s of segs) for (const p of s) {
    const k = p[0] + "," + p[1];
    if (vistas.has(k)) continue;
    const t = ((p[0] - a.x) * vx + (p[1] - a.y) * vy) / (L * L);
    const d = Math.abs((p[0] - a.x) * vy - (p[1] - a.y) * vx) / L;
    if (t > -0.25 && t < 1.25 && d < ancho) { vistas.add(k); out.push(p); }
  }
  return out.slice(0, 24);
}
function angulos(c, esquinas, radio, uniformes) {
  const ang = [];
  for (let i = 0; i < uniformes; i++) ang.push((i / uniformes) * Math.PI * 2);
  for (const e of esquinas) {
    const dx = e[0] - c.x, dy = e[1] - c.y, d = Math.hypot(dx, dy);
    if (d <= radio) continue;
    const base = Math.atan2(dy, dx), off = Math.acos(Math.min(1, radio / d)), eps = 0.012;
    ang.push(base + off + eps, base + off - eps, base - off + eps, base - off - eps);
  }
  return ang;
}

/**
 * ¿Hay línea de visión entre dos casillas? Se traza de borde a borde del
 * círculo, como manda el manual, y las puertas cerradas o dañadas tapan.
 */
function hayVision(estado, idA, idB, uniformes = 20) {
  const mapa = estado.mapa;
  const a = mapa.casillas.get(idA), b = mapa.casillas.get(idB);
  if (!a || !b) return false;
  if (idA === idB) return true;
  const r = mapa.radio * 0.92;
  const segs = cercanos(mapa, a, b, mapa.radio * 2).concat(segmentosVentanasFalsas(estado));
  const opacas = [];
  for (const [id, p] of Object.entries(estado.puertas)) {
    if (id === idA || id === idB) continue;
    if (p === "cerrada" || p === "dañada" || p === "falsa") {
      const c = mapa.casillas.get(id);
      if (c) opacas.push(c);
    }
  }
  const centro = [[a.x, a.y], [b.x, b.y]];
  let libre = true;
  for (const sg of segs) if (cruzan(centro[0], centro[1], sg[0], sg[1])) { libre = false; break; }
  if (libre) for (const d of opacas)
    if (cortaCirculo(centro[0], centro[1], d.x, d.y, mapa.radio)) { libre = false; break; }
  if (libre) return true;

  const esq = esquinasCerca(a, b, segs, mapa.radio);
  const A = angulos(a, esq, r, uniformes), B = angulos(b, esq, r, uniformes);
  for (const t1 of A) {
    const p1 = [a.x + Math.cos(t1) * r, a.y + Math.sin(t1) * r];
    for (const t2 of B) {
      const p2 = [b.x + Math.cos(t2) * r, b.y + Math.sin(t2) * r];
      let tapado = false;
      for (const s of segs) if (cruzan(p1, p2, s[0], s[1])) { tapado = true; break; }
      if (!tapado) for (const d of opacas)
        if (cortaCirculo(p1, p2, d.x, d.y, mapa.radio)) { tapado = true; break; }
      if (!tapado) return true;
    }
  }
  return false;
}
function segmentosVentanasFalsas(estado) {
  const segs = [];
  for (const clave of Object.keys(estado.ventanas)) {
    if (estado.ventanas[clave] !== "falsa") continue;
    const [x, y] = clave.split("|");
    const a = estado.mapa.casillas.get(x), b = estado.mapa.casillas.get(y);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * estado.mapa.radio, ny = dx / L * estado.mapa.radio;
    segs.push([[mx - nx, my - ny], [mx + nx, my + ny]]);
  }
  return segs;
}

// ─────────────────────────────────────────────── adyacencia y distancia

function bloqueaPaso(estado, id) {
  const p = estado.puertas[id];
  return p === "cerrada" || p === "dañada" || p === "falsa";
}
function vecinasDe(estado, id, opciones = {}) {
  const out = [];
  for (const p of estado.pasadizos) {
    const otro = p[0] === id ? p[1] : p[1] === id ? p[0] : null;
    if (otro && !bloqueaPaso(estado, otro) && !estado.barricadas.includes(otro))
      out.push({ id: otro, tipo: "pasadizo" });
  }
  for (const v of estado.mapa.vecinas.get(id) || []) {
    if (!opciones.ignorarBarricadas && estado.barricadas.includes(v.id)) continue;
    if (v.tipo === "special" || v.tipo === "blocked") continue;   // no dan paso
    if (v.tipo === "window" && estado.ventanas[clave(id, v.id)] === "falsa") continue;
    if (!opciones.ignorarPuertas && bloqueaPaso(estado, v.id)) continue;
    out.push(v);
  }
  return out;
}
function clave(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

/** Distancia en casillas siguiendo líneas de movimiento. null si no hay ruta. */
function distancia(estado, desde, hasta, opciones = {}) {
  if (desde === hasta) return 0;
  const visto = new Set([desde]);
  let frente = [desde], d = 0;
  while (frente.length) {
    const sig = [];
    d++;
    for (const id of frente) for (const v of vecinasDe(estado, id, opciones)) {
      if (visto.has(v.id)) continue;
      if (v.id === hasta) return d;
      visto.add(v.id); sig.push(v.id);
    }
    frente = sig;
    if (d > 80) break;
  }
  return null;
}
function aMenosDe(estado, desde, n, opciones = {}) {
  const visto = new Set([desde]);
  let frente = [desde];
  for (let d = 0; d < n; d++) {
    const sig = [];
    for (const id of frente) for (const v of vecinasDe(estado, id, opciones)) {
      if (!visto.has(v.id)) { visto.add(v.id); sig.push(v.id); }
    }
    frente = sig;
  }
  visto.delete(desde);
  return visto;
}

// ─────────────────────────────────────────────── luz

/** Brillante manda sobre Tenue, y Tenue sobre Oscura. */
function luzDe(estado, id) {
  const c = estado.mapa.casillas.get(id);
  if (!c) return null;
  if (estado.linternas.some(l => l.casillas.includes(id))) return "brillante";
  if (c.zone && estado.zonasEncendidas.has(c.zone)) return "brillante";
  if (estado.brillantes.has(id)) return "brillante";
  if (c.zone && estado.zonasAtenuadas.has(c.zone)) return "tenue";   // ficha de Penumbra
  return c.light === "dark" ? "oscura" : "tenue";
}

// ─────────────────────────────────────────────── partida

// Cartas de Ataque del Carnicero. Todas: adyacente, 1 de Acecho y ficha de Sombra.
const CARTAS_ATAQUE = {
  "Desgarrar": {
    coste: 1,
    efecto: (e, inv) => {
      ponEstado(inv, "Lisiado");
      return "roba 3 Heridas, entrégale 1 y el Estado Lisiado, y descarta las otras 2";
    },
  },
  "Arremetida": {
    coste: 1, repetible: true,
    efecto: (e, inv) => {
      ponEstado(inv, "Lisiado");
      const solo = !e.investigadores.some(o => o !== inv &&
        (distancia(e, inv.casilla, o.casilla) ?? 99) <= 4);
      return solo ? "recibe 1 Herida y el Estado Lisiado, y 2 Heridas más por estar aislado"
                  : "recibe 1 Herida y el Estado Lisiado";
    },
  },
  "Eviscerar": {
    coste: 1,
    efecto: (e, inv) => {
      if (inv.estados && inv.estados.includes("Hemorragia")) return "ya sangraba: recibe 1 Herida";
      ponEstado(inv, "Hemorragia");
      return "recibe el Estado Hemorragia";
    },
  },
};
function ponEstado(inv, estado) {
  if (!inv.estados) inv.estados = [];
  if (!inv.estados.includes(estado)) inv.estados.push(estado);
}

/*
 * Habilidades del Carnicero. La Recarga funciona así: al usar una carta con
 * Recarga N entra BOCA ABAJO en el área N. Al final del turno del Adversario,
 * en este orden: las boca arriba de Recarga 1 pasan a Activas, las boca arriba
 * de Recarga 2 pasan a Recarga 1, y por último se voltean boca arriba todas las
 * que quedaran boca abajo. Así una carta de Recarga 1 se pierde una ronda.
 */
const HABILIDADES = {
  "Ojo malévolo": {
    recarga: 1, coste: 0, casillas: 2,
    efecto: (e, dat) => {
      e.ojos = (dat && dat.casillas ? dat.casillas : []).slice(0, 2);
      return `Coloca fichas de Ojo Malévolo en ${e.ojos.join(" y ")}.`;
    },
  },
  "Mirada siniestra": {
    recarga: 1, coste: 1, objetivos: 2,
    efecto: (e, dat) => {
      const ids = (dat && dat.objetivos) || [];
      const estados = (dat && dat.estados) || ["Terror sofocante", "Tinieblas"];
      ids.forEach((id, i) => {
        const inv = e.investigadores.find(x => x.id === id);
        if (inv) ponEstado(inv, estados[i % estados.length]);
      });
      return `${ids.join(" y ")} reciben un Estado: ${estados.join(" / ")}.`;
    },
  },
  "Oscuridad vengativa": {
    recarga: 1, coste: 0, reservada: true,      // solo toca su propia carta
    efecto: (e) => {
      e.adversario.oscuridad = (e.adversario.oscuridad || 0) + e.linternas.length;
      return `Acumula ${e.adversario.oscuridad} ficha(s) de Linterna; con 2 se cambian por 1 de Acecho.`;
    },
  },
  "Putrefacción": {
    recarga: 1, coste: 1,
    efecto: (e) => {
      e.putrefaccion = e.ronda + 1;
      return "Usar una Linterna cuesta 1 Carga adicional durante la ronda siguiente.";
    },
  },
  "Presencia perturbada": {
    recarga: 1, coste: 0,
    efecto: (e) => {
      const cerca = e.investigadores.filter(i =>
        (distancia(e, e.adversario.casilla, i.casilla) ?? 99) <= 4).map(i => i.id);
      if (!cerca.length) return "No hay nadie a 4 casillas o menos: sin efecto.";
      if (cerca.length >= 2) e.adversario.acecho = Math.min(8, e.adversario.acecho + 1);
      return `${cerca.join(", ")} pierden 1 de Resistencia, sin provocar Herida.` +
             (cerca.length >= 2 ? " El Acecho sube 1." : "");
    },
  },
  "Terror creciente": {
    recarga: 2, coste: 0, reservada: true,      // solo afecta a su propia pista
    efecto: (e) => {
      e.adversario.terrorCreciente = true;
      return "La próxima vez que gane Acecho al Acechar, lo duplica.";
    },
  },
};

/** ¿Está la carta disponible, es decir, en el área de Activas? */
function habilidadDisponible(estado, nombre) {
  const h = HABILIDADES[nombre], a = estado.adversario;
  if (!h) return { ok: false, motivo: "no existe esa Habilidad" };
  if (!a.habilidades.includes(nombre)) return { ok: false, motivo: "no llevas esa Habilidad" };
  const sitio = a.recarga[nombre];
  if (sitio && sitio.zona !== "activa")
    return { ok: false, motivo: `está en Recarga ${sitio.zona === "r1" ? 1 : 2}` };
  if (a.acecho < h.coste)
    return { ok: false, motivo: `cuesta ${h.coste} de Acecho y tienes ${a.acecho}` };
  return { ok: true };
}
function usarHabilidad(estado, nombre, datos) {
  const puede = habilidadDisponible(estado, nombre);
  if (!puede.ok) return resultado(false, puede.motivo);
  const h = HABILIDADES[nombre], a = estado.adversario;
  a.acecho -= h.coste;
  const texto = h.efecto(estado, datos);
  a.recarga[nombre] = { zona: "r" + h.recarga, bocaAbajo: true };
  return resultado(true, null, [anuncia(estado, `${nombre}: ${texto}`, !!h.reservada)]);
}
/** Los tres pasos de la Recarga, en el orden exacto del reglamento. */
function recargar(estado) {
  const r = estado.adversario.recarga, movidas = [];
  for (const [n, c] of Object.entries(r))
    if (c.zona === "r1" && !c.bocaAbajo) { c.zona = "activa"; movidas.push(n); }
  for (const c of Object.values(r))
    if (c.zona === "r2" && !c.bocaAbajo) c.zona = "r1";
  for (const c of Object.values(r))
    if (c.zona !== "activa" && c.bocaAbajo) c.bocaAbajo = false;
  return movidas;
}

/*
 * Objetivos del Aserradero. Al reunir la Evidencia, los Investigadores roban
 * 1 carta de Camión al azar, 1 de Caja Fuerte al azar y la de Desterrar, y
 * eligen una. Las casillas son las impresas en las cartas.
 */
const ESCAPES = {
  "Camión — Serrería": { tipo: "camion", camion: "220",
    piezas: { "1-2": ["G-5", "121", "191"], "3-4": ["A-5", "36", "O-2"], "5-6": ["H-7", "H-9", "S-1"] } },
  "Camión — Garaje": { tipo: "camion", camion: "G-6",
    piezas: { "1-2": ["S-37", "308", "313"], "3-4": ["50", "134", "159"], "5-6": ["12", "A-7", "A-19"] } },
  "Caja Fuerte — Puerta norte": { tipo: "caja", sierra: "S-17", salida: "10",
    caja: { "1-2": "S-1", "3-4": "104", "5-6": "S-41" } },
  "Caja Fuerte — Puerta sur": { tipo: "caja", sierra: "S-28", salida: "306",
    caja: { "1-2": "101", "3-4": "S-33", "5-6": "222" } },
  "Desterrar al Carnicero": { tipo: "desterrar" },
};
/*
 * Desterrar al Carnicero. El Adversario coloca la Tumba real bocarriba en su
 * minimapa a 10 casillas o menos de un Investigador, y una Tumba bocabajo en
 * el tablero central a 3 casillas o menos de la real. Los Investigadores
 * revelan la real iluminándola, la exhuman, y la Tumba arde: bocarriba al
 * colocarla, bocabajo al final de la ronda siguiente y fuera a la otra. Solo
 * entonces sirve el Garfio. Si se acaba el tiempo con este Objetivo, empate.
 */
function prepararDestierro(estado, rnd) {
  const idx = Math.floor(rnd() * estado.investigadores.length);
  const objetivo = estado.investigadores[idx];
  const generales = id => {
    const n = estado.mapa.casillas.get(id);
    return n && (n.type === "general" || n.type === "start");
  };
  const cerca = [...aMenosDe(estado, objetivo.casilla, 10)].filter(generales);
  const real = cerca[Math.floor(rnd() * cerca.length)];
  const pistas = [...aMenosDe(estado, real, 3)].filter(generales).concat([real]);
  const señuelo = pistas[Math.floor(rnd() * pistas.length)];
  estado.destierro = { real, señuelo, exhumada: false, arde: null, garfioUsado: 0 };
  estado.escape = { nombre: "Desterrar al Carnicero", tipo: "desterrar", fichas: {} };
  return resultado(true, null, [anuncia(estado,
    `Colocad la ficha de Tumba bocabajo en ${señuelo}. La Tumba de verdad está a 3 casillas o menos de ahí.`)]);
}
/** Iluminar la casilla correcta destapa la Tumba. */
function revisarTumba(estado) {
  const d = estado.destierro;
  if (!d || d.descubierta) return [];
  if (luzDe(estado, d.real) !== "brillante") return [];
  d.descubierta = true;
  return [anuncia(estado, `¡La Tumba está en ${d.real}! Podéis exhumarla con una Acción Involucrada.`)];
}
function exhumar(estado, idInv) {
  const d = estado.destierro;
  if (!d) return resultado(false, "no estáis con el Objetivo de Desterrar");
  if (!d.descubierta) return resultado(false, "la Tumba aún no ha salido a la luz");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv || inv.casilla !== d.real) return resultado(false, "hay que estar en la casilla de la Tumba");
  if (d.exhumada) return resultado(false, "ya está exhumada");
  d.exhumada = true;
  d.arde = "bocarriba";
  return resultado(true, null, [anuncia(estado,
    `${idInv} saca el Garfio y las Cuerdas deshilachadas. La Tumba empieza a arder en ${d.real}.`)]);
}
/** El Garfio: una vez por ronda, señalar una casilla adyacente. */
function usarGarfio(estado, idInv, casilla) {
  const d = estado.destierro;
  if (!d || !d.exhumada) return resultado(false, "aún no tenéis el Garfio");
  if (d.arde !== null) return resultado(false, "la Tumba todavía arde: el Garfio no sirve");
  if (d.garfioUsado === estado.ronda) return resultado(false, "el Garfio ya se ha usado esta ronda");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  if (distancia(estado, inv.casilla, casilla) !== 1)
    return resultado(false, "hay que señalar una casilla adyacente");
  d.garfioUsado = estado.ronda;
  if (casilla === estado.adversario.casilla) {
    estado.desenlace = "investigadores";
    return resultado(true, null, [anuncia(estado, `¡El Garfio alcanza al Carnicero en ${casilla}! Queda desterrado.`)]);
  }
  return resultado(true, null, [anuncia(estado, `No está en ${casilla}.`)]);
}
/** Cuerdas deshilachadas: obliga a una Sombra bocabajo a 3 casillas o menos. */
function usarCuerdas(estado, rnd) {
  const d = estado.destierro;
  if (!d || !d.exhumada) return resultado(false, "aún no tenéis las Cuerdas");
  d.cuerdas = (d.cuerdas || 0) + 1;
  if (d.cuerdas > 3) return resultado(false, "las Cuerdas ya se han gastado");
  const cerca = [...aMenosDe(estado, estado.adversario.casilla, 3), estado.adversario.casilla];
  const donde = cerca[Math.floor((rnd ? rnd() : Math.random()) * cerca.length)];
  ponSombra(estado, donde, true);          // las Cuerdas piden una bocabajo
  return resultado(true, null, [anuncia(estado,
    `Sombra bocabajo en ${donde}. Quedan ${3 - d.cuerdas} usos de las Cuerdas.`)]);
}

/*
 * Mazo de Eventos del Aserradero. Se monta como dice el reglamento: 1 Mayor
 * al azar boca abajo en el fondo, encima las Moderadas barajadas y encima las
 * Menores barajadas. Se roba 1 al empezar cada ronda.
 */
const EVENTOS = [
  { n: "El incendio se propaga", nivel: 1, texto: "El incendio se extiende, pero es tolerable por ahora. Sin efecto." },
  { n: "El incendio se propaga (2)", nivel: 1, texto: "El incendio se extiende, pero es tolerable por ahora. Sin efecto." },
  { n: "Árbol caído", nivel: 1, adversario: true, texto: "El Adversario puede colocar 1 ficha de Puerta Falsa en una casilla de Puerta vacía, o 1 ficha de Ventana Falsa en una Ventana, a su elección." },
  { n: "Llamarada", nivel: 1, adversario: true, texto: "El Adversario puede reducir en 1 la Carga de hasta 2 Investigadores." },
  { n: "Humo leve", nivel: 1, texto: "Esta ronda, los Investigadores solo pueden usar la línea central de sus Linternas para trazar la línea de visión." },
  { n: "Calor abrasador", nivel: 1, texto: "Esta ronda, Correr cuesta 1 Resistencia adicional." },
  { n: "Aire ascendente", nivel: 1, texto: "Esta ronda, los Investigadores tienen 1 MP menos." },
  { n: "Humareda", nivel: 2, texto: "Esta ronda, los Investigadores no pueden obtener Carga como Acción Final (ni siquiera Descansando)." },
  { n: "Pirocúmulos", nivel: 2, texto: "Esta ronda, los Investigadores que Corran tiran 1D6: con 4 o más reciben 1 Herida." },
  { n: "Cortafuegos", nivel: 2, texto: "Los edificios mantienen el incendio a raya por ahora. Sin efecto." },
  { n: "Vórtice", nivel: 2, adversario: true, texto: "El Adversario elige 1 Zona y coloca fichas de Puerta Destruida en hasta 2 casillas de Puerta y 1 ficha de Ventana Abierta en 1 Ventana de esa Zona. Cada Investigador en esa Zona pierde 1 Resistencia y 1 Carga, sin provocar Herida." },
  { n: "Tormenta de fuego", nivel: 3, permanente: true, texto: "El resto de la partida, Mover cuesta 1 Resistencia. Los Investigadores aún pueden obtener Carga como Acción Final si Descansan." },
  { n: "Gases tóxicos", nivel: 3, permanente: true, texto: "Ahora y al inicio de cada ronda, cada Investigador tira su dado de Correr: con un 3 voltea 1 Herida bocarriba, o recibe 1 Herida al azar si no tiene ninguna. No cuenta como Acción de Correr ni afecta al movimiento ni a la Resistencia." },
  { n: "Remolino de fuego", nivel: 3, permanente: true, adversario: true, texto: "Ahora y al inicio de cada ronda, tira 1D6. Con 1-3 cada Investigador pierde 1 Carga y 1 Resistencia, sin provocar Herida. Con 4-6 el Adversario coloca fichas de Puerta Destruida en todas las casillas de Puerta de 1 Zona a su elección, y puede voltear 1 ficha de Puerta Falsa a otra casilla vacía; cada Investigador en esa Zona voltea 1 Herida bocarriba al azar." },
];
/** Monta el mazo: Menores arriba, Moderadas en medio y 1 Mayor al fondo. */
function montarEventos(rnd) {
  const baraja = a => { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };
  const men = baraja(EVENTOS.filter(e => e.nivel === 1));
  const mod = baraja(EVENTOS.filter(e => e.nivel === 2));
  const may = baraja(EVENTOS.filter(e => e.nivel === 3))[0];
  return men.concat(mod, may ? [may] : []);
}
function robarEvento(estado) {
  if (!estado.mazoEventos) return resultado(true, null, []);        // partida sin Eventos
  if (!estado.mazoEventos.length) {
    // el mazo termina en el Evento Mayor, que es permanente y sigue disparándose
    const may = estado.eventoActual;
    if (may && may.permanente)
      return resultado(true, null, [anuncia(estado, `Sigue en vigor: ${may.n}. ${may.texto}`)]);
    estado.eventoActual = null;
    return resultado(false, "mazo agotado",
      [anuncia(estado, "El mazo de Eventos se ha agotado.")]);
  }
  const c = estado.mazoEventos.shift();   // se descarta el anterior y se resuelve el nuevo
  estado.eventoActual = c;
  if (c.permanente) estado.eventosPermanentes.push(c.n);
  const texto = `Evento: ${c.n}. ${c.texto}` +
    (c.adversario ? " (esta carta la decide el Adversario)" : "");
  return resultado(true, null, [anuncia(estado, texto)]);
}
/** Lo que decide el Adversario en las cartas que se lo permiten. */
function resolverEventoAdversario(estado, rnd) {
  const c = estado.eventoActual;
  if (!c || !c.adversario) return resultado(true, null, []);
  const a = estado.adversario, anuncios = [];
  const elige = arr => arr[Math.floor(rnd() * arr.length)];
  if (c.n === "Árbol caído") {
    // tapiar una puerta vacía cercana a los investigadores
    const puertas = [...estado.mapa.casillas.values()].filter(n =>
      n.type === "door" && (estado.puertas[n.id] || "abierta") === "abierta");
    if (puertas.length) {
      const p = elige(puertas);
      estado.puertas[p.id] = "falsa";
      anuncios.push(anuncia(estado, `Puerta Falsa en ${p.id}.`));
    }
  } else if (c.n === "Llamarada") {
    const dos = estado.investigadores.slice(0, 2).map(i => i.id);
    anuncios.push(anuncia(estado, `${dos.join(" y ")} pierden 1 de Carga.`));
  } else if (c.n === "Vórtice" || c.n === "Remolino de fuego") {
    // la Zona donde haya más investigadores
    const cuenta = {};
    for (const i of estado.investigadores) {
      const z = estado.mapa.casillas.get(i.casilla)?.zone;
      if (z) cuenta[z] = (cuenta[z] || 0) + 1;
    }
    const zona = Object.entries(cuenta).sort((x, y) => y[1] - x[1])[0];
    const z = zona ? zona[0] : elige([...estado.mapa.zonas]);
    const puertas = [...estado.mapa.casillas.values()].filter(n => n.type === "door" && n.zone === z);
    for (const p of puertas) estado.puertas[p.id] = "destruida";
    anuncios.push(anuncia(estado,
      `Zona elegida: ${z}. Puertas Destruidas en ${puertas.map(p => p.id).join(", ") || "ninguna"}.` +
      ` Los Investigadores en ${z} sufren lo que indica la carta.`));
  }
  return resultado(true, null, anuncios);
}

/*
 * Segunda fase: una vez elegido el Objetivo. Cada acción tiene su límite de
 * "una vez por ronda para todo el grupo", tal y como dicen las cartas.
 */
const RECOMPENSAS = {
  "Revelar 1 Punto de Interés": { repetible: true },
  "Ficha de Ventana Abierta":   { repetible: true },
  "Robar 1 Objeto General":     { repetible: true },
  "Robar 1 Objeto Maldito":     { repetible: false },
  "Ficha de Penumbra":          { repetible: false },
  "Ficha de Pasadizo Secreto":  { repetible: false },
  "Robar 1 Objeto Médico":      { repetible: false },
  "Dar 1 ficha de Habilidad Mayor": { repetible: false },
};
function recompensasDisponibles(estado) {
  return Object.keys(RECOMPENSAS).filter(r =>
    RECOMPENSAS[r].repetible || !(estado.recompensasGastadas || []).includes(r));
}
function tomarRecompensa(estado, nombre) {
  if (!recompensasDisponibles(estado).includes(nombre))
    return resultado(false, "esa recompensa ya se ha usado o no existe");
  if (!RECOMPENSAS[nombre].repetible) estado.recompensasGastadas.push(nombre);
  const anuncios = [anuncia(estado, `Recompensa: ${nombre}.`)];
  if (nombre === "Revelar 1 Punto de Interés") {
    const pdi = estado.ocultos.find(o => o.tipo === "pdi");
    if (pdi) {
      estado.ocultos = estado.ocultos.filter(o => o !== pdi);
      anuncios.push(anuncia(estado, `La ficha del Punto de Interés de ${pdi.de} está en ${pdi.casilla}.`));
    } else anuncios.push(anuncia(estado, "Ya no quedan fichas de Punto de Interés escondidas."));
  }
  return resultado(true, null, anuncios);
}

/** Instalar 1 pieza del Camión: una por ronda para todo el grupo. */
function instalarPieza(estado, idInv) {
  const e = estado.escape;
  if (!e || e.tipo !== "camion") return resultado(false, "no estáis con el Objetivo del Camión");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv || inv.casilla !== e.fichas.camion) return resultado(false, "hay que estar en la casilla del Camión");
  if (e.progreso.instaladoEstaRonda) return resultado(false, "ya se ha instalado una pieza esta ronda");
  if (e.progreso.piezas >= 3) return resultado(false, "ya están las tres piezas");
  e.progreso.piezas++; e.progreso.instaladoEstaRonda = true;
  return resultado(true, null, [anuncia(estado,
    `Pieza instalada: ${e.progreso.piezas} de 3 en el Camión.`)]);
}
/** Arrancar: 1 pieza con un 6, 2 piezas con 4 o más, 3 piezas seguro. */
function arrancarCamion(estado, dado) {
  const e = estado.escape;
  if (!e || e.tipo !== "camion") return resultado(false, "no estáis con el Objetivo del Camión");
  if (e.progreso.arrancadoEstaRonda) return resultado(false, "ya se ha intentado arrancar esta ronda");
  if (!e.progreso.piezas) return resultado(false, "hace falta al menos 1 pieza instalada");
  e.progreso.arrancadoEstaRonda = true;
  const umbral = e.progreso.piezas === 1 ? 6 : e.progreso.piezas === 2 ? 4 : 1;
  const anuncios = [];
  if (dado < umbral)
    return resultado(true, null, [anuncia(estado, `El motor no arranca (${dado}, hacía falta ${umbral}).`)]);
  anuncios.push(anuncia(estado, "¡El camión arranca!"));
  for (const i of estado.investigadores) {
    if (i.muerto || i.escapado) continue;
    const d = distancia(estado, i.casilla, e.fichas.camion);
    if (d !== null && d <= 1) { i.escapado = true; anuncios.push(anuncia(estado, `${i.id} escapa en el camión.`)); }
  }
  const quedan = estado.investigadores.filter(i => !i.escapado && !i.muerto);
  if (!quedan.length) {
    estado.desenlace = "investigadores";
    anuncios.push(anuncia(estado, "Todos fuera. Ganan los Investigadores."));
  } else {
    e.progreso.escapeDisponible = true;
    anuncios.push(anuncia(estado,
      `Colocad la ficha de Escape en la 10 o en la 306: ${quedan.map(i => i.id).join(", ")} aún pueden salir por ahí.`));
  }
  return resultado(true, null, anuncios);
}
/** Serrar la Caja: 1 Suministro, y si se arriesgan, el dado puede dar otro o una Herida. */
function abrirCaja(estado, idInv, dado) {
  const e = estado.escape;
  if (!e || e.tipo !== "caja") return resultado(false, "no estáis con el Objetivo de la Caja Fuerte");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv || inv.casilla !== e.fichas.sierra) return resultado(false, "hay que estar en la casilla de la Sierra");
  if (e.progreso.abiertoEstaRonda) return resultado(false, "ya se ha usado la Sierra esta ronda");
  e.progreso.abiertoEstaRonda = true;
  e.progreso.supply++;
  const anuncios = [anuncia(estado, `Suministro ${e.progreso.supply} de 4 en la Caja Fuerte.`)];
  if (dado !== undefined) {
    const brillante = luzDe(estado, inv.casilla) === "brillante";
    const falla = brillante ? dado <= 2 : dado <= 4;
    if (falla) {
      anuncios.push(...herir(estado, idInv).anuncios);
    } else {
      e.progreso.supply++;
      anuncios.push(anuncia(estado, `La suerte acompaña: Suministro ${e.progreso.supply} de 4.`));
    }
  }
  if (e.progreso.supply >= 4 && !e.progreso.fusible) {
    e.progreso.fusible = true;
    anuncios.push(anuncia(estado, "La Caja Fuerte se abre: obtenéis el Fusible."));
  }
  return resultado(true, null, anuncios);
}
/** Activar la Salida Bloqueada con el Fusible. */
function activarSalida(estado, idInv) {
  const e = estado.escape;
  if (!e || e.tipo !== "caja") return resultado(false, "no estáis con el Objetivo de la Caja Fuerte");
  if (!e.progreso.fusible) return resultado(false, "aún no tenéis el Fusible");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv || inv.casilla !== e.fichas.salida) return resultado(false, "hay que estar en la Salida Bloqueada");
  if (e.progreso.escapeDisponible) return resultado(false, "la Salida ya está abierta");
  e.progreso.escapeDisponible = true;
  return resultado(true, null, [anuncia(estado,
    `La Salida de ${e.fichas.salida} queda abierta: cualquiera puede escapar desde ahí.`)]);
}
/** Salir por la ficha de Escape. */
function escaparPorSalida(estado, idInv, casilla) {
  const e = estado.escape;
  if (!e || !e.progreso.escapeDisponible) return resultado(false, "todavía no hay salida abierta");
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  const validas = e.tipo === "caja" ? [e.fichas.salida] : ["10", "306"];
  const donde = casilla || inv.casilla;
  if (!validas.includes(donde))
    return resultado(false, `hay que estar en ${validas.join(" o ")}`);
  return escapar(estado, idInv);
}

const EVIDENCIA_NECESARIA = { 2: 2, 3: 3, 4: 5 };
const tramoDado = d => d <= 2 ? "1-2" : d <= 4 ? "3-4" : "5-6";

/** Reparte una mano de Escape: 1 Camión, 1 Caja Fuerte y Desterrar. */
function manoDeEscape(rnd) {
  const camion = ["Camión — Serrería", "Camión — Garaje"];
  const caja = ["Caja Fuerte — Puerta norte", "Caja Fuerte — Puerta sur"];
  return [camion[Math.floor(rnd() * 2)], caja[Math.floor(rnd() * 2)], "Desterrar al Carnicero"];
}
/** Prepara el objetivo elegido y devuelve las instrucciones de mesa. */
function elegirEscape(estado, nombre, dado) {
  const c = ESCAPES[nombre];
  if (!c) return resultado(false, "no existe esa carta de Escape");
  if (estado.escape) return resultado(false, "ya hay un Objetivo elegido");
  estado.escape = { nombre, tipo: c.tipo, fichas: {},
    progreso: { piezas: 0, supply: 0, fusible: false, escapeDisponible: false,
                instaladoEstaRonda: false, arrancadoEstaRonda: false, abiertoEstaRonda: false } };
  const pasos = [];
  const tr = tramoDado(dado || 1);
  if (c.tipo === "camion") {
    estado.escape.fichas.camion = c.camion;
    const [bat, her, buj] = c.piezas[tr];
    Object.assign(estado.escape.fichas, { bateria: bat, herramientas: her, bujia: buj });
    pasos.push(`Camión en ${c.camion}.`,
               `Con un ${dado} en el D6: Batería en ${bat}, Herramientas en ${her} y Bujía en ${buj}.`);
  } else if (c.tipo === "caja") {
    Object.assign(estado.escape.fichas, { sierra: c.sierra, salida: c.salida, caja: c.caja[tr] });
    pasos.push(`Sierra en ${c.sierra} y Salida Bloqueada en ${c.salida}.`,
               `Con un ${dado} en el D6: Caja Fuerte en ${c.caja[tr]}.`);
  } else {
    estado.escape = null;
    const r = prepararDestierro(estado, () => Math.random());
    return r;
  }
  pasos.forEach(t => anuncia(estado, t));
  return resultado(true, null, pasos);
}

const PERFILES = {
  carnicero: { nombre: "El Carnicero", mp: 5, sprintGratis: true,
               seRevelaAlMoverse: true, romperPuertaAlcance: 1, acecha: true,
               retiraSombraAlEmpezar: true, desapareceEnBrillante: false },
  horror:    { nombre: "El Horror Insaciable", mp: 4, sprintGratis: true,
               seRevelaAlMoverse: false, romperPuertaAlcance: 3, acecha: false,
               retiraSombraAlEmpezar: false, desapareceEnBrillante: true },
};

/** El manual deja al Adversario colocarse donde quiera; aquí se sortea. */
function colocacionInicial(estado, rnd, minimo = 8) {
  const inicios = estado.investigadores.map(i => i.casilla);
  const buenas = [], todas = [...estado.mapa.casillas.keys()];
  for (const id of todas) {
    if (estado.mapa.casillas.get(id).type === "door") continue;
    let lejos = true;
    for (const s of inicios) {
      const d = distancia(estado, id, s);
      if (d === null || d < minimo) { lejos = false; break; }
    }
    if (lejos) buenas.push(id);
  }
  const bolsa = buenas.length ? buenas : todas;
  return bolsa[Math.floor(rnd() * bolsa.length)];
}

function crearPartida(opciones) {
  const mapa = prepararMapa(opciones.mapa);
  const perfil = Object.assign({}, PERFILES[opciones.adversario] || PERFILES.carnicero,
                               opciones.perfil || {});
  const estado = {
    mapa, perfil,
    ronda: 1,
    fase: "eventos",
    investigadores: (opciones.investigadores || []).map(i => ({
      id: i.id, casilla: i.casilla, escalofrio: null,
    })),
    adversario: {
      casilla: opciones.adversarioEn || null,
      oculto: true, mp: 0, sprintTirado: false,
      acecho: 0, acechadosEstaRonda: new Set(), atacadosEsteTurno: new Set(),
      haDesaparecido: false, cartas: (opciones.cartas || ["Desgarrar"]),
      habilidades: ((opciones.investigadores || []).length <= 2
        ? (opciones.habilidades || []).slice(0, 1)      // con 2 Investigadores, solo 1
        : (opciones.habilidades || [])),
      recarga: {}, oscuridad: 0,
      ventanasSonadas: new Set(), cartasUsadas: new Set(),
      accionesUsadas: new Set(),
    },
    puertas: Object.assign({}, opciones.puertas),      // id -> abierta|cerrada|dañada|destruida
    ventanas: Object.assign({}, opciones.ventanas),    // "a|b" -> normal|abierta|falsa
    zonasEncendidas: new Set(opciones.zonasEncendidas || []),
    lucesFundidas: new Set(opciones.lucesFundidas || []),
    zonasAtenuadas: new Set(opciones.zonasAtenuadas || []),
    pasadizos: [],        // pares de casillas que quedan conectadas
    delatoras: [],        // fichas tipo Latas: avisan si el Adversario las pisa
    barricadas: [],       // casillas que el Adversario no puede cruzar
    linternas: [],                                     // [{de, casillas:[]}]
    brillantes: new Set(),                             // casillas brillantes sueltas
    ruido: new Set(),                                  // claves de ventana con ficha de Ruido
    sombra: null,              // la bocarriba: solo hay una y se traslada
    sombrasOcultas: [],        // las bocabajo de las Cuerdas deshilachadas
    evidencias: 0,
    evidenciaNecesaria: EVIDENCIA_NECESARIA[(opciones.investigadores || []).length] ?? 5,
    escape: null,
    desenlace: null,                     // null | "adversario" | "investigadores" | "empate"
    recompensasGastadas: [],
    mazoEventos: null, eventoActual: null, eventosPermanentes: [],
    registro: [],
  };
  for (const id of estado.mapa.casillas.keys())
    if (estado.mapa.casillas.get(id).type === "door" && !(id in estado.puertas))
      estado.puertas[id] = "abierta";
  return estado;
}

/**
 * El Adversario tiene 1 ficha de Sombra bocarriba. Si ya estaba en el tablero
 * cuando toca colocarla, se traslada: no deja un rastro de varias.
 * Las bocabajo (Cuerdas deshilachadas) son fichas aparte y sí se acumulan.
 */
function ponSombra(estado, casilla, bocabajo) {
  if (bocabajo) {
    if (!estado.sombrasOcultas.includes(casilla)) estado.sombrasOcultas.push(casilla);
  } else {
    estado.sombra = casilla;
  }
}
/** Todas las que hay en el tablero, para dibujarlas y anunciarlas. */
function sombrasEnTablero(estado) {
  return (estado.sombra ? [estado.sombra] : []).concat(estado.sombrasOcultas);
}
/** Heridas. A la cuarta, el Investigador muere y el Carnicero gana. */
function herir(estado, idInv, cuantas = 1) {
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  if (inv.muerto) return resultado(false, `${idInv} ya está muerto`);
  if (inv.escapado) return resultado(false, `${idInv} ya ha escapado`);
  inv.heridas = Math.min(4, (inv.heridas || 0) + cuantas);   // a la cuarta se muere
  const anuncios = [anuncia(estado, `${idInv} va por ${inv.heridas} Herida(s).`)];
  if (inv.heridas >= 4 && !inv.muerto) {
    inv.muerto = true;
    estado.desenlace = "adversario";
    anuncios.push(anuncia(estado, `${idInv} muere. El Carnicero gana la partida.`));
  }
  return resultado(true, null, anuncios);
}
function escapar(estado, idInv) {
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  if (!estado.escape) return resultado(false, "aún no hay Objetivo elegido");
  inv.escapado = true;
  const anuncios = [anuncia(estado, `${idInv} escapa.`)];
  if (estado.investigadores.every(i => i.escapado || i.muerto)) {
    estado.desenlace = "investigadores";
    anuncios.push(anuncia(estado, "Todos han escapado. Ganan los Investigadores."));
  }
  return resultado(true, null, anuncios);
}
/** Entregar Evidencia en una casilla de Ordenador. */
function entregarEvidencia(estado, idInv, cuantas = 1, casilla) {
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  const donde = casilla || inv.casilla;
  if (estado.mapa.casillas.get(donde)?.type !== "terminal")
    return resultado(false, "hay que estar en una casilla de Ordenador");
  if (cuantas < 1) return resultado(false, "hay que entregar al menos 1");
  if (estado.evidencias + cuantas > 5)
    return resultado(false, "solo hay 5 fichas de Evidencia en el tablero");
  estado.evidencias += cuantas;
  const anuncios = [anuncia(estado,
    `${idInv} entrega ${cuantas} Evidencia(s): ${estado.evidencias} de ${estado.evidenciaNecesaria}.`)];
  if (estado.evidencias >= estado.evidenciaNecesaria && !estado.escape)
    anuncios.push(anuncia(estado, "Ya podéis elegir Objetivo de escape cuando queráis."));
  return resultado(true, null, anuncios);
}

/**
 * Un anuncio público es lo que el Adversario diría en voz alta: fichas que
 * toca en el tablero central y cosas que les pasan a los Investigadores.
 * Lo reservado se queda detrás de su pantalla y solo sale en el informe final.
 */
function anuncia(estado, texto, privado) {
  estado.registro.push({ ronda: estado.ronda, texto, privado: !!privado });
  return privado ? { texto, privado: true } : texto;
}
function resultado(ok, motivo, anuncios = []) { return { ok, motivo, anuncios }; }

// ─────────────────────────────────────────────── turno del Adversario

/** Retira las fichas de Ruido y devuelve al Adversario sus puntos de movimiento. */
function iniciarTurnoAdversario(estado) {
  const anuncios = [];
  if (estado.ruido.size) {
    anuncios.push(anuncia(estado, `Retirad las ${estado.ruido.size} fichas de Ruido del tablero.`));
    estado.ruido.clear();
  }
  if (estado.ojos && estado.ojos.length) {
    anuncios.push(anuncia(estado, `Retirad las fichas de Ojo Malévolo de ${estado.ojos.join(", ")}.`));
    estado.ojos = [];
  }
  const enTablero = sombrasEnTablero(estado);
  if (estado.perfil.retiraSombraAlEmpezar && enTablero.length) {
    anuncios.push(anuncia(estado, `Retirad las fichas de Sombra de ${enTablero.join(", ")}.`));
    estado.sombra = null; estado.sombrasOcultas = [];
  }
  const a = estado.adversario;
  a.mp = estado.perfil.mp;
  a.sprintTirado = false;
  a.ventanasSonadas.clear();
  a.cartasUsadas.clear();
  a.accionesUsadas.clear();
  a.acechadosEstaRonda.clear();
  a.atacadosEsteTurno.clear();
  a.haDesaparecido = false;
  estado.fase = "adversario";
  return resultado(true, null, anuncios);
}

/** Tirada de Sprint, gratuita y una sola vez por turno. */
function sprint(estado, tirada) {
  const a = estado.adversario;
  if (a.sprintTirado) return resultado(false, "el Sprint ya se ha usado este turno");
  a.sprintTirado = true;
  a.mp += tirada;
  return resultado(true, null, []);
}

/**
 * Mueve al Adversario paso a paso. Devuelve lo que hay que decir en voz alta:
 * los ruidos de ventana y, si se revela, dónde está exactamente.
 */
function mover(estado, ruta) {
  const a = estado.adversario, anuncios = [];
  let coste = 0;
  let actual = a.casilla;
  for (const destino of ruta) {
    let paso = (estado.mapa.vecinas.get(actual) || []).find(v => v.id === destino);
    if (!paso && estado.pasadizos.some(p =>
        (p[0] === actual && p[1] === destino) || (p[1] === actual && p[0] === destino)))
      paso = { id: destino, tipo: "pasadizo" };
    if (!paso) return resultado(false, `${actual} y ${destino} no están conectadas`);
    if (paso.tipo === "special" || paso.tipo === "blocked")
      return resultado(false, `no se puede mover de ${actual} a ${destino}`);
    const k = clave(actual, destino);
    if (paso.tipo === "window" && estado.ventanas[k] === "falsa")
      return resultado(false, `la ventana entre ${actual} y ${destino} es falsa`);
    if (estado.barricadas.includes(destino))
      return resultado(false, `${destino} está barricada`);
    if (bloqueaPaso(estado, destino))
      return resultado(false, estado.puertas[destino] === "falsa"
        ? `${destino} es una Puerta Falsa` : `la puerta de ${destino} está ${estado.puertas[destino]}`);

    let c = 1;                                   // para el Adversario, Oscura cuesta 1
    if (paso.tipo === "window" && estado.ventanas[k] !== "abierta") c += 1;
    if (coste + c > a.mp)
      return resultado(false, `no alcanza: hacen falta ${coste + c} MP y quedan ${a.mp}`);
    coste += c;
    actual = destino;

    if (paso.tipo === "window" && estado.ventanas[k] !== "abierta" && !a.ventanasSonadas.has(k)) {
      a.ventanasSonadas.add(k);
      estado.ruido.add(k);
      const [x, y] = k.split("|");
      anuncios.push(anuncia(estado, `Ruido en la ventana entre ${x} y ${y}.`));
    }
    a.casilla = destino;
    if (estado.delatoras.includes(destino)) {
      estado.delatoras = estado.delatoras.filter(c => c !== destino);
      anuncios.push(anuncia(estado, `Se oye algo en ${destino}: voltead la ficha.`));
    }
    if (estado.perfil.seRevelaAlMoverse && a.oculto && luzDe(estado, destino) === "brillante") {
      a.oculto = false;
      anuncios.push(anuncia(estado, `El Adversario queda Revelado en ${destino}.`));
    }
  }
  a.mp -= coste;
  return resultado(true, null, anuncios);
}

/** ¿Puede acecharse a este investigador ahora mismo? */
function puedeAcechar(estado, idInv) {
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return { ok: false, motivo: "no existe ese investigador" };
  if (!estado.perfil.acecha) return { ok: false, motivo: "este Adversario no Acecha" };
  if (!estado.adversario.oculto) return { ok: false, motivo: "estando Revelado no se puede Acechar" };
  if (estado.adversario.haDesaparecido)
    return { ok: false, motivo: "tras Desaparecer no se puede Acechar ni Atacar" };
  if (estado.adversario.acechadosEstaRonda.has(idInv))
    return { ok: false, motivo: "ya has Acechado a ese investigador esta ronda" };
  if (estado.adversario.accionesUsadas.has("acechar"))
    return { ok: false, motivo: "ya has usado la Acción de Acechar este turno" };
  const d = distancia(estado, estado.adversario.casilla, inv.casilla);
  if (d === null || d > 8) return { ok: false, motivo: `está a ${d === null ? "ninguna" : d} casillas, y el límite es 8` };
  if (!hayVision(estado, estado.adversario.casilla, inv.casilla))
    return { ok: false, motivo: "no hay línea de visión" };
  return { ok: true, distancia: d };
}

/**
 * Acecha. La segunda ronda seguida sobre el mismo investigador sube el Acecho.
 * Obliga a colocar la ficha de Sombra en la casilla desde la que se acecha.
 */
function acechar(estado, objetivos) {
  const a = estado.adversario;
  const ids = Array.isArray(objetivos) ? objetivos : [objetivos];
  if (a.accionesUsadas.has("acechar"))
    return resultado(false, "ya has usado la Acción de Acechar este turno");
  if (!ids.length) return resultado(false, "hay que indicar a quién se Acecha");
  for (const id of ids) {
    const puede = puedeAcechar(estado, id);
    if (!puede.ok) return resultado(false, `${id}: ${puede.motivo}`);
  }
  const anuncios = [];
  a.accionesUsadas.add("acechar");
  ponSombra(estado, a.casilla);
  anuncios.push(anuncia(estado, `Sombra en ${a.casilla}.`));
  for (const id of ids) {
    const inv = estado.investigadores.find(i => i.id === id);
    a.acechadosEstaRonda.add(id);
    if (inv.escalofrio) {
      inv.escalofrio = null;
      a.acecho = Math.min(8, a.acecho + (a.terrorCreciente ? 2 : 1));
      if (a.terrorCreciente) a.terrorCreciente = false;
      anuncios.push(anuncia(estado, `${id} devuelve su ficha de Escalofrío.`));
      anuncios.push(anuncia(estado, `El Acecho sube a ${a.acecho}.`, true));
    } else {
      inv.escalofrio = { ronda: estado.ronda };
      anuncios.push(anuncia(estado, `${id} recibe una ficha de Escalofrío.`));
    }
  }
  return resultado(true, null, anuncios);
}

/**
 * Ataque. Las tres cartas del Carnicero exigen estar adyacente, gastan 1 de
 * Acecho y obligan a colocar la ficha de Sombra en la casilla desde la que atacas.
 */
function puedeAtacar(estado, idInv, carta) {
  const a = estado.adversario;
  const c = CARTAS_ATAQUE[carta];
  if (!c) return { ok: false, motivo: "no existe esa carta de Ataque" };
  if (!a.cartas.includes(carta)) return { ok: false, motivo: "no llevas esa carta" };
  if (!a.oculto) return { ok: false, motivo: "estando Revelado no puedes usar cartas de Ataque" };
  if (a.haDesaparecido) return { ok: false, motivo: "tras Desaparecer no se puede Atacar" };
  if (a.cartasUsadas.has(carta) && !c.repetible)
    return { ok: false, motivo: "esa carta ya se ha usado este turno" };
  if (a.atacadosEsteTurno.has(idInv))
    return { ok: false, motivo: "no se puede Atacar dos veces al mismo Investigador" };
  if (a.acecho < c.coste)
    return { ok: false, motivo: `hacen falta ${c.coste} de Acecho y tienes ${a.acecho}` };
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return { ok: false, motivo: "no existe ese investigador" };
  const d = distancia(estado, a.casilla, inv.casilla);
  if (d !== 1) return { ok: false, motivo: "hay que estar adyacente" };
  return { ok: true };
}
function atacar(estado, idInv, carta) {
  const puede = puedeAtacar(estado, idInv, carta);
  if (!puede.ok) return resultado(false, puede.motivo);
  const a = estado.adversario, c = CARTAS_ATAQUE[carta];
  const inv = estado.investigadores.find(i => i.id === idInv);
  a.acecho -= c.coste;
  a.cartasUsadas.add(carta);
  a.atacadosEsteTurno.add(idInv);
  ponSombra(estado, a.casilla);
  const anuncios = [anuncia(estado, `Sombra en ${a.casilla}.`),
                    anuncia(estado, `${carta} sobre ${idInv}: ${c.efecto(estado, inv)}`)];
  return resultado(true, null, anuncios);
}

/** Abierta → dañada → destruida. Hay que estar dentro del alcance del Adversario. */
function romperPuerta(estado, id) {
  const a = estado.adversario;
  if (a.accionesUsadas.has("romper"))
    return resultado(false, "ya has usado Romper Puerta este turno");
  if (estado.mapa.casillas.get(id)?.type !== "door")
    return resultado(false, `${id} no es una puerta`);
  const d = distancia(estado, a.casilla, id, { ignorarPuertas: true });
  if (d === null || d > estado.perfil.romperPuertaAlcance)
    return resultado(false, `la puerta está a ${d === null ? "ninguna" : d} casillas y el alcance es ${estado.perfil.romperPuertaAlcance}`);
  const antes = estado.puertas[id] || "abierta";
  if (antes === "destruida") return resultado(false, "esa puerta ya está destruida");
  if (estado.investigadores.some(i => i.casilla === id && !i.muerto && !i.escapado))
    return resultado(false, "hay un Investigador en esa casilla de Puerta");
  const despues = antes === "dañada" ? "destruida" : "dañada";
  estado.puertas[id] = despues;
  a.accionesUsadas.add("romper");
  return resultado(true, null, [anuncia(estado, `La puerta de ${id} queda ${despues}.`)]);
}

/** Volver a ocultarse. La Sombra se queda donde te vieron por última vez. */
function desaparecer(estado) {
  const a = estado.adversario;
  if (a.oculto) return resultado(false, "el Adversario ya está oculto");
  if (a.accionesUsadas.has("desaparecer"))
    return resultado(false, "ya has usado Desaparecer este turno");
  if (!estado.perfil.desapareceEnBrillante && luzDe(estado, a.casilla) === "brillante")
    return resultado(false, "solo se puede Desaparecer en casilla Tenue u Oscura");
  a.oculto = true;
  a.haDesaparecido = true;          // ya no puede Acechar ni Atacar en este turno
  a.accionesUsadas.add("desaparecer");
  ponSombra(estado, a.casilla);
  return resultado(true, null, [anuncia(estado, `El Adversario desaparece. Sombra en ${a.casilla}.`)]);
}

// ─────────────────────────────────────────────── luces y turno de investigadores

/** Coloca una linterna. Las casillas iluminadas las deciden los jugadores en mesa. */
function ponerLinterna(estado, idInv, casillas) {
  estado.linternas.push({ de: idInv, casillas: casillas.slice() });
  return revisarRevelado(estado);
}
/**
 * Interruptor: ilumina la Zona el resto de la ronda. Al acabar, la ficha pasa
 * a Luces Fallidas y esa Zona ya no puede volver a encenderse en toda la partida.
 */
function encenderZona(estado, zona) {
  if (estado.lucesFundidas.has(zona))
    return resultado(false, `las luces de la Zona ${zona} ya se fundieron: no vuelven a encenderse`);
  if (estado.zonasEncendidas.has(zona))
    return resultado(false, `la Zona ${zona} ya está encendida`);
  estado.zonasEncendidas.add(zona);
  return revisarRevelado(estado);
}
/** Si cierran la puerta en la que está, queda Revelado y tiene que salir. */
function cerrarPuerta(estado, id) {
  if (estado.mapa.casillas.get(id)?.type !== "door") return resultado(false, `${id} no es una puerta`);
  const actual = estado.puertas[id] || "abierta";
  if (actual !== "abierta") return resultado(false, `esa puerta está ${actual}`);
  estado.puertas[id] = "cerrada";
  const anuncios = [];
  if (estado.adversario.casilla === id) {
    estado.adversario.oculto = false;
    const salidas = vecinasDe(estado, id).map(v => v.id);
    anuncios.push(anuncia(estado, `¡El Adversario estaba en ${id}! Queda Revelado y sale a ${salidas[0] || "la casilla contigua"}.`));
    if (salidas.length) estado.adversario.casilla = salidas[0];
  }
  return resultado(true, null, anuncios);
}

function moverInvestigador(estado, idInv, casilla) {
  const inv = estado.investigadores.find(i => i.id === idInv);
  if (!inv) return resultado(false, "no existe ese investigador");
  inv.casilla = casilla;
  const anuncios = [];
  if (estado.ojos && estado.ojos.includes(casilla)) {
    estado.ojos = estado.ojos.filter(c => c !== casilla);
    estado.adversario.acecho = Math.min(8, estado.adversario.acecho + 1);
    anuncios.push(anuncia(estado, `${idInv} ha pisado un Ojo Malévolo en ${casilla}: retirad la ficha.`));
    anuncios.push(anuncia(estado, `El Acecho sube a ${estado.adversario.acecho}.`, true));
  }
  return resultado(true, null, anuncios);
}
/** Si el Adversario queda en Brillante, se revela al instante. */
function revisarRevelado(estado) {
  const a = estado.adversario;
  if (a.oculto && a.casilla && luzDe(estado, a.casilla) === "brillante") {
    a.oculto = false;
    return resultado(true, null, [anuncia(estado, `El Adversario queda Revelado en ${a.casilla}.`)]);
  }
  return resultado(true, null, []);
}

// ─────────────────────────────────────────────── fin de ronda

/**
 * Retira linternas, caduca los Escalofríos que no se renovaron y avanza el contador.
 */
/** Cierra el turno del Adversario: es cuando se resuelve la Recarga. */
function terminarTurnoAdversario(estado) {
  const vuelven = recargar(estado);
  const anuncios = vuelven.length
    ? [anuncia(estado, `Vuelven a estar disponibles: ${vuelven.join(", ")}.`, true)] : [];
  // las fichas de Ojo Malévolo se retiran al empezar su siguiente turno
  estado.fase = "finRonda";
  return resultado(true, null, anuncios);
}

function finDeRonda(estado) {
  const anuncios = [];
  const d = estado.destierro;
  if (d && d.arde === "bocarriba") { d.arde = "bocabajo"; anuncios.push(anuncia(estado, "La Tumba sigue ardiendo.")); }
  else if (d && d.arde === "bocabajo") { d.arde = null; anuncios.push(anuncia(estado, "La Tumba se ha consumido: el Garfio ya sirve.")); }
  if (estado.linternas.length) {
    anuncios.push(anuncia(estado, "Retirad todas las linternas del tablero."));
    estado.linternas = [];
  }
  for (const z of estado.zonasEncendidas) {
    estado.lucesFundidas.add(z);
    anuncios.push(anuncia(estado, `Las luces de la Zona ${z} se funden: voltead la ficha a Luces Fallidas. No volverán a encenderse.`));
  }
  estado.zonasEncendidas.clear();
  for (const inv of estado.investigadores) {
    if (inv.escalofrio && inv.escalofrio.ronda < estado.ronda) {
      inv.escalofrio = null;
      anuncios.push(anuncia(estado, `${inv.id} devuelve su Escalofrío: no ha sido Acechado esta ronda.`));
    }
  }
  if (estado.ronda >= 17) {
    if (estado.escape && estado.escape.tipo === "desterrar") {
      estado.desenlace = "empate";
      anuncios.push(anuncia(estado, "Se acaba el tiempo con el Objetivo de Desterrar: la partida queda en tablas."));
      estado.fase = "fin";
      return resultado(true, null, anuncios);
    }
    const quedan = estado.investigadores.filter(i => !i.escapado && !i.muerto);
    if (quedan.length) {
      estado.desenlace = "adversario";
      anuncios.push(anuncia(estado,
        `Se acaba el tiempo. ${quedan.map(i => i.id).join(", ")} no han escapado y cuentan como muertos: gana el Carnicero.`));
    } else {
      estado.desenlace = "investigadores";
      anuncios.push(anuncia(estado, "Se acaba el tiempo, pero todos habían escapado."));
    }
    estado.fase = "fin";
    return resultado(true, null, anuncios);
  }
  if (estado.escape && estado.escape.progreso) {
    estado.escape.progreso.instaladoEstaRonda = false;
    estado.escape.progreso.arrancadoEstaRonda = false;
    estado.escape.progreso.abiertoEstaRonda = false;
  }
  estado.ronda += 1;
  estado.fase = "eventos";
  anuncios.push(anuncia(estado, `Empieza la ronda ${estado.ronda}.`));
  return resultado(true, null, anuncios);
}

// ─────────────────────────────────────────────── qué se cuenta y qué no

/** Lo que el Adversario diría en voz alta en su turno. */
function parteDelTurno(estado, anuncios) {
  const a = estado.adversario;
  const partes = anuncios.slice();
  if (!a.oculto) partes.push(`El Adversario está a la vista en ${a.casilla}.`);
  else if (sombrasEnTablero(estado).length)
    partes.push(`Sombra en ${sombrasEnTablero(estado).join(", ")}.`);
  return partes;
}
/** Lo que nunca debe salir de detrás de la pantalla. */
function estadoOculto(estado) {
  return {
    casilla: estado.adversario.casilla,
    mpRestante: estado.adversario.mp,
    acecho: estado.adversario.acecho,
  };
}

const api = {
  crearPartida, prepararMapa,
  luzDe, hayVision, distancia, aMenosDe, vecinasDe, clave,
  iniciarTurnoAdversario, sprint, mover, puedeAcechar, acechar,
  romperPuerta, desaparecer, finDeRonda, puedeAtacar, atacar, CARTAS_ATAQUE, sombrasEnTablero,
  HABILIDADES, habilidadDisponible, usarHabilidad, recargar, terminarTurnoAdversario,
  ESCAPES, EVIDENCIA_NECESARIA, manoDeEscape, elegirEscape,
  herir, escapar, entregarEvidencia, colocacionInicial, cerrarPuerta,
  RECOMPENSAS, recompensasDisponibles, tomarRecompensa,
  instalarPieza, arrancarCamion, abrirCaja, activarSalida, escaparPorSalida,
  prepararDestierro, revisarTumba, exhumar, usarGarfio, usarCuerdas,
  EVENTOS, montarEventos, robarEvento, resolverEventoAdversario,
  ponerLinterna, encenderZona, moverInvestigador, revisarRevelado,
  parteDelTurno, estadoOculto, PERFILES,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.MotorTSD = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
