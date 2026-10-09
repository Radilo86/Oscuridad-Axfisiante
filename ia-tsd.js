/*
 * IA del Adversario para The Stifling Dark.
 *
 * No busca la jugada perfecta: busca jugar como un humano competente.
 * Genera planes, los puntúa, los ordena y elige entre los mejores con una
 * probabilidad que decae por puesto, de modo que nunca es predecible.
 */
(function (raiz) {
"use strict";
const M = (typeof require === "function" && typeof module !== "undefined")
  ? require("/mnt/user-data/outputs/motor-tsd.js") : raiz.MotorTSD;

// caras reales del dado de Sprint
const CARAS_SPRINT = [2, 3, 2, 4, 3, 3];

const NIVELES = {
  // caida: cuánto cae la probabilidad por puesto · ruido: capricho al puntuar
  // miopia: hasta dónde mira para Acechar · remata: cuánto se ceba con el herido
  // dudaAtaque: con qué probabilidad deja escapar un ataque que podía hacer
  facil:   { nombre: "Fácil",   caida: 0.80, ruido: 0.35, miopia: 5,  agresion: 0.6, remata: 0 },
  normal:  { nombre: "Normal",  caida: 0.45, ruido: 0.18, miopia: 8,  agresion: 1.0, remata: 6 },
  dificil: { nombre: "Difícil", caida: 0.20, ruido: 0.06, miopia: 99, agresion: 1.4, remata: 16 },
};

// generador reproducible, para poder repetir una partida si hace falta
function azar(semilla) {
  let s = (semilla >>> 0 || 1) ^ 0x9e3779b9;
  const paso = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 12; i++) paso();     // sin calentar, semillas parecidas dan tiradas iguales
  return paso;
}

/** Alcance del Adversario: coste mínimo a cada casilla, con su ruta. */
function alcance(estado, desde, mp) {
  const coste = new Map([[desde, 0]]), previo = new Map();
  let frente = [desde];
  while (frente.length) {
    const sig = [];
    for (const id of frente) {
      const c0 = coste.get(id);
      for (const v of M.vecinasDe(estado, id)) {
        let c = c0 + 1;                                   // Oscura cuesta 1 al Adversario
        if (v.tipo === "window" && estado.ventanas[M.clave(id, v.id)] !== "abierta") c += 1;
        if (c > mp) continue;
        if (!coste.has(v.id) || c < coste.get(v.id)) {
          coste.set(v.id, c); previo.set(v.id, id); sig.push(v.id);
        }
      }
    }
    frente = sig;
  }
  return { coste, previo };
}
function ruta(previo, destino) {
  const r = [];
  let x = destino;
  while (previo.has(x)) { r.unshift(x); x = previo.get(x); }
  return r;
}

/**
 * Mapa de Acecho: para cada investigador, desde qué casillas se le puede Acechar.
 * Se calcula una sola vez por turno porque la línea de visión es cara.
 */
function mapaDeAcecho(estado, nivel) {
  const tabla = new Map();                 // casilla -> [{id, distancia, tieneEscalofrio}]
  for (const inv of estado.investigadores) {
    const alcance = Math.min(8, nivel.miopia);
    const cerca = M.aMenosDe(estado, inv.casilla, alcance);
    cerca.add(inv.casilla);
    const dist = new Map();
    let frente = [inv.casilla]; dist.set(inv.casilla, 0);
    for (let d = 1; d <= alcance; d++) {
      const sig = [];
      for (const id of frente) for (const v of M.vecinasDe(estado, id))
        if (!dist.has(v.id)) { dist.set(v.id, d); sig.push(v.id); }
      frente = sig;
    }
    for (const casilla of cerca) {
      if (!M.hayVision(estado, casilla, inv.casilla)) continue;
      if (!tabla.has(casilla)) tabla.set(casilla, []);
      tabla.get(casilla).push({ id: inv.id, distancia: dist.get(casilla) || 0,
                                tieneEscalofrio: !!inv.escalofrio, heridas: inv.heridas || 0 });
    }
  }
  return tabla;
}
function acechablesDesde(tabla, casilla) { return tabla.get(casilla) || []; }

/** Las ventanas delatan: cuesta 1 MP y deja una ficha de Ruido en el tablero. */
function ventanasDeLaRuta(estado, desde, ruta) {
  let n = 0, actual = desde;
  for (const sig of ruta || []) {
    const paso = (estado.mapa.vecinas.get(actual) || []).find(v => v.id === sig);
    if (paso && paso.tipo === "window" &&
        estado.ventanas[M.clave(actual, sig)] !== "abierta" &&
        !estado.adversario.ventanasSonadas.has(M.clave(actual, sig))) n++;
    actual = sig;
  }
  return n;
}
/** Casillas que hay que vigilar una vez elegido el Objetivo. */
function fichasDelObjetivo(estado) {
  if (!estado.escape || !estado.escape.fichas) return [];
  return Object.values(estado.escape.fichas).filter(Boolean);
}

/** Cuánto vale quedarse en una casilla al terminar el turno. */
function valorPosicion(estado, casilla, nivel, tabla, distInv) {
  let v = 0;
  const luz = M.luzDe(estado, casilla);
  if (luz === "brillante") v -= 60;          // quedarse a la vista es malo
  else if (luz === "oscura") v += 6;         // la oscuridad protege
  const cerca = distInv.has(casilla) ? distInv.get(casilla) : null;
  if (cerca !== null) {
    // querer estar cerca, pero no pegado si eso obliga a cruzar luz
    v += Math.max(0, 14 - cerca) * 1.6 * nivel.agresion;
    // con Acecho guardado interesa quedar adyacente, que es desde donde se Ataca;
    // compartir casilla no cuenta como adyacente
    if (cerca === 1) v += (estado.adversario.acecho >= 1 ? 45 : 8) * nivel.agresion;
    else if (cerca === 0) v += 4 * nivel.agresion;
  }
  // posiciones desde las que mañana se podrá Acechar
  const futuros = acechablesDesde(tabla, casilla).length;
  v += futuros * 9;

  // con el Objetivo elegido, vigilar las fichas hacia las que van ellos:
  // guardar algo que nadie está buscando no sirve de nada
  for (const f of fichasDelObjetivo(estado)) {
    const d = M.distancia(estado, casilla, f);
    if (d === null || d > 7) continue;
    let dInv = null;
    for (const i of estado.investigadores) {
      const di = M.distancia(estado, i.casilla, f);
      if (di !== null && (dInv === null || di < dInv)) dInv = di;
    }
    if (dInv === null || dInv > 10) continue;
    const urgencia = Math.max(0, 11 - dInv) / 10;          // 0 lejos, 1 encima
    v += (8 - d) * 5 * urgencia * nivel.agresion;
  }
  return v;
}

/** Genera y puntúa planes de turno. */
function planes(estado, nivel, rnd) {
  const a = estado.adversario;
  const { coste, previo } = alcance(estado, a.casilla, a.mp);
  const lista = [];
  const candidatas = [...coste.keys()];
  const tabla = mapaDeAcecho(estado, nivel);
  // distancia de cada casilla al investigador más cercano, en una sola pasada
  const distInv = new Map();
  let frente = estado.investigadores.map(i => i.casilla);
  frente.forEach(id => distInv.set(id, 0));
  for (let d = 1; d <= 20 && frente.length; d++) {
    const sig = [];
    for (const id of frente) for (const v of M.vecinasDe(estado, id))
      if (!distInv.has(v.id)) { distInv.set(v.id, d); sig.push(v.id); }
    frente = sig;
  }

  // 1) planes que Acechan: ir a un punto de Acecho y terminar en otro sitio
  const puntos = [];
  for (const p of candidatas) {
    const obj = acechablesDesde(tabla, p);
    if (!obj.length) continue;
    let val = 0;
    // cerrar el Acecho vale más, y rematar a quien ya va tocado, más todavía
    for (const o of obj) val += (o.tieneEscalofrio ? 40 : 18) + o.heridas * nivel.remata;
    val += obj.length > 1 ? 10 : 0;
    puntos.push({ casilla: p, objetivos: obj, valor: val, coste: coste.get(p) });
  }
  puntos.sort((x, y) => y.valor - x.valor || x.coste - y.coste);

  for (const p of puntos.slice(0, 12)) {
    const resto = a.mp - p.coste;
    const sub = alcance(estado, p.casilla, resto);
    let mejor = null;
    for (const f of sub.coste.keys()) {
      const v = valorPosicion(estado, f, nivel, tabla, distInv);
      if (!mejor || v > mejor.v) mejor = { f, v };
    }
    lista.push({
      tipo: "acechar",
      imprescindible: true,
      acecharEn: p.casilla, objetivos: p.objetivos.map(o => o.id),
      rutaIda: ruta(previo, p.casilla),
      rutaVuelta: mejor ? ruta(sub.previo, mejor.f) : [],
      final: mejor ? mejor.f : p.casilla,
      puntos: p.valor + (mejor ? mejor.v : 0),
    });
  }

  // 2) planes sin Acecho: solo colocarse
  for (const f of candidatas) {
    lista.push({
      tipo: "colocarse", final: f, rutaIda: ruta(previo, f), rutaVuelta: [],
      objetivos: [], puntos: valorPosicion(estado, f, nivel, tabla, distInv),
    });
  }

  // 3) romper una puerta cercana, si abre camino hacia alguien
  for (const [id, est] of Object.entries(estado.puertas)) {
    if (est === "destruida") continue;
    for (const p of candidatas) {
      const d = M.distancia(estado, p, id, { ignorarPuertas: true });
      if (d !== 1) continue;
      const base = lista.find(x => x.tipo === "colocarse" && x.final === p);
      lista.push(Object.assign({}, base, {
        tipo: "romper", puerta: id,
        puntos: (base ? base.puntos : 0) + (est === "cerrada" ? 16 : 8),
      }));
      break;
    }
  }

  // descontar por cada ventana que delataría el paso
  const castigo = 14 * (nivel.agresion > 1 ? 1.4 : nivel.agresion < 1 ? 0.6 : 1);
  for (const p of lista) {
    let v = ventanasDeLaRuta(estado, estado.adversario.casilla, p.rutaIda);
    const trasIda = p.rutaIda && p.rutaIda.length ? p.rutaIda[p.rutaIda.length - 1] : estado.adversario.casilla;
    v += ventanasDeLaRuta(estado, trasIda, p.rutaVuelta);
    p.ventanas = v;
    p.puntos -= v * castigo;
  }
  for (const p of lista) p.puntos += (rnd() - 0.5) * 2 * nivel.ruido * 40;
  // Acechar y Atacar son su condición de victoria: si hay ocasión, va a por ella
  if (lista.some(p => p.imprescindible)) {
    const soloAcecho = lista.filter(p => p.imprescindible);
    soloAcecho.sort((x, y) => y.puntos - x.puntos);
    const resto = lista.filter(p => !p.imprescindible).sort((x, y) => y.puntos - x.puntos);
    return soloAcecho.concat(resto);
  }
  lista.sort((x, y) => y.puntos - x.puntos);
  return lista;
}

/** Elige por puesto: la mejor casi siempre, la segunda a veces, la tercera poco. */
function elegir(lista, nivel, rnd) {
  if (!lista.length) return null;
  const hayAcecho = lista.some(p => p.imprescindible);
  const n = hayAcecho
    ? Math.min(lista.filter(p => p.imprescindible).length, 8)   // elige entre los que Acechan
    : Math.min(lista.length, 8);
  const pesos = [];
  let suma = 0;
  for (let i = 0; i < n; i++) { const w = Math.pow(nivel.caida, i); pesos.push(w); suma += w; }
  let r = rnd() * suma;
  for (let i = 0; i < n; i++) { r -= pesos[i]; if (r <= 0) return { plan: lista[i], puesto: i + 1 }; }
  return { plan: lista[0], puesto: 1 };
}

/**
 * Juega el turno completo del Adversario sobre el estado.
 * Devuelve los anuncios en el orden en que hay que decirlos.
 */
function jugarTurno(estado, opciones = {}) {
  const nivel = NIVELES[opciones.nivel] || NIVELES.normal;
  const rnd = opciones.rnd || azar(Date.now());
  const anuncios = [];
  const empieza = M.iniciarTurnoAdversario(estado);
  anuncios.push(...empieza.anuncios);

  // el dado de Sprint es gratuito, así que siempre se tira
  const cara = opciones.dado !== undefined ? opciones.dado
             : CARAS_SPRINT[Math.floor(rnd() * CARAS_SPRINT.length)];
  M.sprint(estado, cara);

  const lista = planes(estado, nivel, rnd);
  const elegido = elegir(lista, nivel, rnd);
  if (!elegido) return { anuncios, plan: null };
  const p = elegido.plan;

  if (p.rutaIda && p.rutaIda.length) anuncios.push(...M.mover(estado, p.rutaIda).anuncios);
  if (p.tipo === "acechar" && p.objetivos.length) {
    const r = M.acechar(estado, p.objetivos);
    if (r.ok) anuncios.push(...r.anuncios);
  }
  if (p.tipo === "romper" && p.puerta) {
    const r = M.romperPuerta(estado, p.puerta);
    if (r.ok) anuncios.push(...r.anuncios);
  }
  if (p.rutaVuelta && p.rutaVuelta.length) anuncios.push(...M.mover(estado, p.rutaVuelta).anuncios);

  // ya colocado: si alguien ha quedado adyacente y hay Acecho que gastar, atacar.
  // cuanto más duro el nivel, más se ceba con quien está más cerca de morir
  const victimas = estado.investigadores.slice().sort((x, y) =>
    nivel.remata ? (y.heridas || 0) - (x.heridas || 0) : rnd() - 0.5);
  for (const inv of victimas) {
    if (estado.adversario.acecho < 1) break;
    for (const carta of estado.adversario.cartas) {
      if (!M.puedeAtacar(estado, inv.id, carta).ok) continue;
      const r = M.atacar(estado, inv.id, carta);
      if (r.ok) anuncios.push(...r.anuncios);
      break;
    }
  }


  // habilidades: se usan cuando tienen efecto, con algo de capricho
  for (const nombre of estado.adversario.habilidades || []) {
    if (!M.habilidadDisponible(estado, nombre).ok) continue;
    if (rnd() > (nivel.agresion > 1 ? 0.9 : 0.6)) continue;      // no siempre
    const datos = {};
    if (nombre === "Ojo malévolo") {
      // dos casillas Generales por donde probablemente pasen
      const cerca = [...M.aMenosDe(estado, estado.investigadores[0] ?
        estado.investigadores[0].casilla : estado.adversario.casilla, 3)]
        .filter(id => { const n = estado.mapa.casillas.get(id); return n && n.type === "general"; });
      datos.casillas = cerca.slice(0, 2);
      if (datos.casillas.length < 2) continue;
    }
    if (nombre === "Mirada siniestra") {
      datos.objetivos = estado.investigadores.slice(0, 2).map(i => i.id);
      if (datos.objetivos.length < 2) continue;
    }
    const r = M.usarHabilidad(estado, nombre, datos);
    if (r.ok) anuncios.push(...r.anuncios);
  }

  // si quedó a la vista y puede esconderse, lo hace
  if (!estado.adversario.oculto) {
    const r = M.desaparecer(estado);
    if (r.ok) anuncios.push(...r.anuncios);
  }
  anuncios.push(...M.terminarTurnoAdversario(estado).anuncios);
  return { anuncios, plan: p, puesto: elegido.puesto, dado: cara, opciones: lista.length,
           secreto: { casilla: estado.adversario.casilla, mp: estado.adversario.mp,
                      acecho: estado.adversario.acecho, oculto: estado.adversario.oculto,
                      tipo: p.tipo, ventanas: p.ventanas || 0,
                      ruta: (p.rutaIda || []).concat(p.rutaVuelta || []) } };
}

const api = { NIVELES, CARAS_SPRINT, azar, ventanasDeLaRuta, fichasDelObjetivo, alcance, mapaDeAcecho, acechablesDesde, valorPosicion, planes, elegir, jugarTurno };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.IA_TSD = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
