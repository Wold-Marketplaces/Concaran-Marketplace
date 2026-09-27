/* ============================================================================
 *  Tilisarao Market - Lógica de vendedores y publicaciones
 *  Sin dependencias. Usa la API REST de Supabase directamente.
 * ==========================================================================*/
(function (global) {
  'use strict';

  // --------------------------------------------------------------------------
  //  Config
  // --------------------------------------------------------------------------
  const URL_BASE = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
  const KEY = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
  const BUCKET = typeof SUPABASE_BUCKET !== 'undefined' ? SUPABASE_BUCKET : 'fotos-productos';
  const CATS = typeof CATEGORIAS !== 'undefined' ? CATEGORIAS : [];
  // Mercado al que pertenece esta web. Se lee de la constante TIENDA que
  // define js/supabase-config.js. Con esta sola linea el mismo archivo
  // sirve para todos los mercados: cada web muestra y guarda publicaciones
  // de su propio pueblo.
  const MI_TIENDA = (typeof TIENDA !== 'undefined' && TIENDA)
    ? String(TIENDA).toLowerCase()
    : 'tilisarao';
  // Nombre que se muestra al comprador: va en el mensaje de WhatsApp y en
  // las tarjetas. Cada mercado muestra el suyo.
  const NOMBRE = (typeof NOMBRE_TIENDA !== 'undefined' && NOMBRE_TIENDA)
    ? NOMBRE_TIENDA
    : 'Tilisarao Market';
    const API = URL_BASE + '/rest/v1';


  let session = null;
  const listeners = [];

  /** ¿El admin ya completó js/supabase-config.js? */
  function configOk() {
    return /^https:\/\/.+\.supabase\.co$/.test(URL_BASE) &&
           KEY.length > 20 && !KEY.startsWith('PEGAR_AQUI');
  }

  // --------------------------------------------------------------------------
  //  Utilidades
  // --------------------------------------------------------------------------

  /** Escapa texto antes de meterlo en innerHTML (evita XSS de descripciones). */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Sólo letras/números para wa.me: 5491122334456 */
  function normalizarWhatsApp(tel) {
    return String(tel || '').replace(/\D/g, '');
  }

  /** Texto para el link de WhatsApp, con mensaje listo. */
  function linkWhatsApp(tel, titulo) {
    const num = normalizarWhatsApp(tel);
    if (!num) return '';
    const texto = encodeURIComponent(
      'Hola! Vi tu publicación "' + (titulo || '') + '" en ' + NOMBRE + ' y me interesa.'
    );
    return 'https://wa.me/' + num + '?text=' + texto;
  }

  function etiquetaCategoria(valor) {
    const c = CATS.find(x => x.value === valor);
    return c ? c.label : 'Otros';
  }

  function esCategoriaValida(valor) {
    return CATS.some(x => x.value === valor);
  }

  // --------------------------------------------------------------------------
  //  Capa REST mínima
  // --------------------------------------------------------------------------
  async function refrescarToken() {
    const refresh = localStorage.getItem('tm_refresh');
    if (!refresh) return false;
    try {
      const res = await fetch(URL_BASE + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh })
      });
      if (!res.ok) return false;
      const datos = await res.json();
      session.access_token = datos.access_token;
      if (datos.refresh_token) localStorage.setItem('tm_refresh', datos.refresh_token);
      return true;
    } catch (e) {
      return false;
    }
  }

  // PostgREST devuelve PGRST205 tambien cuando recien creo una tabla y esta
  // recargando su cache de esquema. Dura de segundos a un minuto: se espera y
  // se reintenta varias veces (2s, 4s, 8s) antes de avisarle al usuario.
  const ESPERA_SCHEMA = [2000, 4000, 8000];
  const TOTAL_INTENTOS_SCHEMA = ESPERA_SCHEMA.length;

  function esFaltaDeTabla(datos, status) {
    if (status !== 404 || !datos) return false;
    const msg = typeof datos === 'string' ? datos : (datos.message || '');
    return datos.code === 'PGRST205' ||
           /Could not find the table|schema cache|PGRST204/i.test(msg);
  }

  async function api(ruta, opciones, yaReintentado, intentosSchema) {
    opciones = opciones || {};
    if (intentosSchema === undefined) intentosSchema = 0;
    const cabeceras = {
      apikey: KEY,
      Authorization: 'Bearer ' + (session ? session.access_token : KEY),
      'Content-Type': 'application/json'
    };
    if (opciones.prefer) cabeceras.Prefer = opciones.prefer;

    const res = await fetch(API + ruta, {
      method: opciones.method || 'GET',
      headers: cabeceras,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined
    });

    // El token de acceso dura 1 hora: si expiró, se refresca y se reintenta una vez.
    if (res.status === 401 && !yaReintentado && session) {
      if (await refrescarToken()) return api(ruta, opciones, true, intentosSchema);
    }

    if (res.status === 204) return null;

    const texto = await res.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = texto; }

    // El cache de esquema de PostgREST se recarga solo cuando se toca el schema.
    // Durante esos segundos responde PGRST205 aunque la tabla exista: se espera
    // un poco mas y se reintenta, sin molestar al usuario.
    if (esFaltaDeTabla(datos, res.status) && intentosSchema < TOTAL_INTENTOS_SCHEMA) {
      await new Promise(r => setTimeout(r, ESPERA_SCHEMA[intentosSchema]));
      return api(ruta, opciones, yaReintentado, intentosSchema + 1);
    }

    if (!res.ok) {
      throw errorLegible(datos, res.status);
    }
    return datos;
  }

  /** Traduce los errores de Postgres a algo que se pueda mostrar. */
  function errorLegible(datos, status) {
    const msg = (datos && (datos.message || datos.error_description || datos.msg)) || '';
    const e = new Error(msg || 'Error ' + status);
    e.status = status;
    e.datos = datos;

      if (/No API key found|apikey/i.test(msg)) {
        e.mensajeAmigable =
          'Falta la configuraci\u00f3n de Supabase en el sitio. Recarg\u00e1 con Ctrl+F5. ' +
          'Si sigue igual, avisame y lo reviso.';
      } else if (/duplicate key|already registered|already exists/i.test(msg)) {
      e.mensajeAmigable = 'Ese correo ya está registrado. Probá iniciar sesión.';
    } else if (/Invalid login credentials/i.test(msg)) {
      e.mensajeAmigable = 'Correo o contraseña incorrectos.';
    } else if (/Password should be at least/i.test(msg)) {
      e.mensajeAmigable = 'La contraseña debe tener al menos 6 caracteres.';
    } else if (/Email not confirmed/i.test(msg)) {
      e.mensajeAmigable = 'Tenés que confirmar tu correo primero. Revisá tu email.';
    } else if (datos && (datos.error_code === 'over_email_send_rate_limit' || /only can send \d+ emails/i.test(msg))) {
      e.mensajeAmigable =
        'Se alcanzó el límite de emails de Supabase, así que no se pudo mandar el mail de confirmación. ' +
        'Esperá una hora, o mejor: apagá "Confirm email" en Authentication → Email, y el registro ' +
        'deja de necesitar el mail.';
    } else if (/rate limit|too many/i.test(msg)) {
      e.mensajeAmigable = 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.';
    } else if (datos && datos.code === '23503') {
      e.mensajeAmigable =
        'Tu perfil todavia no esta listo. Recargá la pagina con Ctrl+F5 e intentá de nuevo.';
    } else if (datos && datos.code === 'PGRST205' || /Could not find the table|schema cache/i.test(msg)) {
      e.mensajeAmigable =
        'La base de datos no responde en este momento. La tabla puede faltar, ' +
        'o Supabase estar recargando datos. Probá de nuevo en un minuto; ' +
        'si sigue igual, avisame y lo revisamos.';
    } else if (/bucket|storage/i.test(msg) && /not found|does not exist/i.test(msg)) {
      e.mensajeAmigable =
        'No se encuentra el espacio de fotos en Supabase. Probá de nuevo en un minuto; ' +
        'si sigue igual, avisame y lo revisamos.';
    } else if (status === 400 && /violates row-level security/i.test(msg)) {
      e.mensajeAmigable = 'No tenés permiso para esa operación.';
    } else if (status === 401) {
      e.mensajeAmigable = 'Tu sesión expiró. Volvé a iniciar sesión.';
    } else {
      e.mensajeAmigable = 'No se pudo completar la operación. Probá de nuevo.';
    }
    return e;
  }

  // --------------------------------------------------------------------------
  //  Sesión / Auth
  // --------------------------------------------------------------------------
  const listenersAuth = [];

  async function restaurarSesion() {
    if (!configOk()) return null;
    try {
      const res = await fetch(URL_BASE + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: localStorage.getItem('tm_refresh') || '' })
      });
      if (!res.ok) { localStorage.removeItem('tm_refresh'); return null; }
      const datos = await res.json();
      session = {
        access_token: datos.access_token,
        refresh_token: datos.refresh_token,
        user: datos.user
      };
      localStorage.setItem('tm_refresh', datos.refresh_token || '');
      notificar();
      await asegurarPerfil(datos.user && datos.user.id);
      await tomarPendientes();
      return session;
    } catch (e) {
      return null;
    }
  }

  function notificar() {
    listenersAuth.forEach(fn => {
      try { fn(session); } catch (e) { console.error(e); }
    });
  }

  function onAuthChange(fn) {
    listenersAuth.push(fn);
    return function () {
      const i = listenersAuth.indexOf(fn);
      if (i >= 0) listenersAuth.splice(i, 1);
    };
  }

  function usuarioActual() {
    return session ? session.user : null;
  }

  function guardarSesion(datos) {
    session = {
      access_token: datos.access_token,
      refresh_token: datos.refresh_token,
      user: datos.user
    };
    if (datos.refresh_token) localStorage.setItem('tm_refresh', datos.refresh_token);
    notificar();
    return session;
  }

  function limpiarSesion() {
    session = null;
    localStorage.removeItem('tm_refresh');
    notificar();
  }

  /**
   * Datos que el vendedor mando al registrarse pero todavia no se pudieron
   * guardar porque no habia sesion (pasa cuando la confirmacion de email esta
   * prendida: signup no devuelve token). Quedan aca y se aplican en el primer
   * login, para que el telefono no se pierda.
   */
  function guardarPendientes(datos) {
    try {
      localStorage.setItem('tm_pendientes', JSON.stringify({
        nombre: datos.nombre || '',
        telefono: datos.telefono || ''
      }));
    } catch (e) { /* modo privado */ }
  }

  async function tomarPendientes() {
    let raw = null;
    try { raw = localStorage.getItem('tm_pendientes'); } catch (e) { return null; }
    if (!raw) return null;
    let datos;
    try { datos = JSON.parse(raw); } catch (e) { return null; }
    try { localStorage.removeItem('tm_pendientes'); } catch (e) {}

    if (!datos || (!datos.nombre && !datos.telefono)) return null;
    if (!usuarioActual()) return null;
    try {
      const actual = await obtenerPerfil();
      const patch = {};
      if (datos.nombre && (!actual || !actual.nombre)) patch.nombre = datos.nombre;
      if (datos.telefono) patch.telefono = normalizarWhatsApp(datos.telefono);
      if (!Object.keys(patch).length) return null;
      return await actualizarPerfil(null, patch);
    } catch (e) {
      console.warn('No se pudieron aplicar los datos pendientes:', e.message);
      return null;
    }
  }

  async function registrar(nombre, email, password, telefono) {
    const cuerpo = {
      email: String(email).trim(),
      password: password,
      data: { nombre: String(nombre || '').trim() }
    };
    const res = await fetch(URL_BASE + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw errorLegible(datos, res.status);

    // Si la instancia exige confirmar email, no hay sesión todavía.
    if (!datos.access_token) {
      guardarPendientes({ nombre: cuerpo.data.nombre, telefono: telefono });
      return { requiereConfirmacion: true, email: cuerpo.email };
    }
    guardarSesion(datos);
    await asegurarPerfil(datos.user.id);
    if (telefono) {
      await actualizarPerfil(datos.user.id, { telefono: telefono }).catch(() => {});
    }
    return { requiereConfirmacion: false, user: datos.user };
  }

  async function iniciarSesion(email, password) {
    const res = await fetch(URL_BASE + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim(), password: password })
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw errorLegible(datos, res.status);
    guardarSesion(datos);
    await asegurarPerfil(datos.user && datos.user.id);
    await tomarPendientes();
    return session;
  }

  async function cerrarSesion() {
    try {
      await fetch(URL_BASE + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
      });
    } catch (e) { /* sin internet: cortamos la sesión local igual */ }
    limpiarSesion();
  }

  // --------------------------------------------------------------------------
  //  Perfil
  // --------------------------------------------------------------------------
  // En este proyecto las escrituras directas sobre la tabla public.perfiles
  // devuelven PGRST205 ("no se encuentra la tabla") aunque la tabla exista y los
  // permisos esten bien: es un problema de PostgREST, no del codigo. Por eso los
  // datos del vendedor se guardan con funciones de base de datos (rpc), que si
  // se resuelven bien. Las funciones devuelven la fila del perfil, asi que
  // tampoco hace falta leer la tabla.

  async function obtenerPerfil(userId) {
    const id = userId || (usuarioActual() && usuarioActual().id);
    if (!id) return null;
    try {
      const res = await api('/rpc/crear_mi_perfil', {
        method: 'POST',
        body: { p_nombre: '' }
      });
      return (res && res[0]) || null;
    } catch (e) {
      // si la funcion no esta disponible, se intenta la lectura directa
      try {
        const res = await api('/profiles?id=eq.' + encodeURIComponent(id) + '&select=*', {
          prefer: 'return=representation'
        });
        return (res && res[0]) || null;
      } catch (e2) {
        return null;
      }
    }
  }

  async function actualizarPerfil(userId, campos) {
    const id = userId || (usuarioActual() && usuarioActual().id);
    if (!id) throw new Error('No hay sesión');
    const patch = {};
    if (campos.nombre !== undefined) patch.nombre = String(campos.nombre).slice(0, 80);
    if (campos.telefono !== undefined) patch.telefono = normalizarWhatsApp(campos.telefono).slice(0, 20);
    if (!Object.keys(patch).length) return null;

    const res = await api('/rpc/guardar_datos_vendedor', {
      method: 'POST',
      body: { p_nombre: patch.nombre || '', p_telefono: patch.telefono || '' }
    });
    return (res && res[0]) || null;
  }

  /**
   * Se asegura de que exista la fila en perfiles.
   *
   * El trigger de la base la crea al registrarse, pero si el usuario se
   * registro antes de que el trigger existiera (o si fallo) queda sin fila, y
   * entonces cualquier INSERT en productos rebota con 409 por la FK.
   * Con esto la app se auto-repara sola.
   */
  async function asegurarPerfil(userId) {
      const id = userId || (usuarioActual() && usuarioActual().id);
      if (!id) return null;
      try {
        const u = usuarioActual();
        const nombre = (u && (u.user_metadata && u.user_metadata.nombre)) || '';
        const res = await api('/rpc/crear_mi_perfil', {
          method: 'POST',
          body: { p_nombre: String(nombre).slice(0, 80) }
        });
        return (res && res[0]) || null;
      } catch (e) {
        console.warn('No se pudo asegurar el perfil:', e.message);
        return null;
      }
    }

  // --------------------------------------------------------------------------
  //  Fotos (Storage)
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  //  Ajustes del sistema (editables desde el Table Editor de Supabase)
  //  Si la tabla no existe o falla la red, se usan estos valores por defecto:
  //  el sitio nunca se rompe por esto.
  // --------------------------------------------------------------------------

  const AJUSTES_POR_DEFECTO = {
    img_habilitada: true,
    img_ancho_max: 1000,
    img_alto_max: 1000,
    img_calidad: 0.80,
    img_peso_max_kb: 200,
    foto_peso_max_mb: 5,
    productos_por_usuario: 40
  };

  let ajustesCargados = null;

  async function ajustes() {
    if (ajustesCargados) return ajustesCargados;
    ajustesCargados = Object.assign({}, AJUSTES_POR_DEFECTO);
    try {
      const res = await api('/config_sistema?id=eq.1&select=*', { method: 'GET' });
      if (Array.isArray(res) && res[0]) {
        const f = res[0];
        ['img_habilitada', 'img_ancho_max', 'img_alto_max', 'img_peso_max_kb',
         'productos_por_usuario'].forEach(k => {
          if (f[k] !== null && f[k] !== undefined) ajustesCargados[k] = f[k];
        });
        ['img_calidad', 'foto_peso_max_mb'].forEach(k => {
          const n = Number(f[k]);
          if (!Number.isNaN(n) && n > 0) ajustesCargados[k] = n;
        });
      }
    } catch (e) {
      console.warn('No se pudieron leer los ajustes, uso los valores por defecto:', e.message);
    }
    return ajustesCargados;
  }

  function validarFoto(archivo) {
    const max = ajustesCargados ? ajustesCargados.foto_peso_max_mb : AJUSTES_POR_DEFECTO.foto_peso_max_mb;
    if (!archivo) return 'Elegí una foto.';
    if (!/^image\//.test(archivo.type)) return 'El archivo tiene que ser una imagen (JPG o PNG).';
    if (archivo.size > max * 1024 * 1024) {
      return 'La foto pesa más de ' + max + 'MB. Subí una más liviana.';
    }
    return null;
  }

  /** Abre una imagen respetando su orientacion EXIF (fotos de celular). */
  async function crearBitmap(archivo) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      } catch (e) { /* algunos navegadores lo rechazan, sigue el camino de abajo */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(archivo);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no se pudo leer la imagen')); };
      img.src = url;
    });
  }

  /**
   * Comprime la foto en el navegador antes de subirla.
   *
   * Recorta al tamaño maximo manteniendo la proporcion y va bajando la calidad
   * hasta entrar en el peso objetivo. Devuelve {archivo, info} con info para
   * mostrarle al vendedor cuanto se le achico.
   */
  async function comprimirFoto(archivo) {
    const a = await ajustes();
    const sinCambios = { archivo: archivo, info: null };

    if (!a.img_habilitada) return sinCambios;
    if (!/^image\//.test(archivo.type)) return sinCambios;
    // si ya estaPEGAR_AQUI chiquita y liviana, no tocar
    if (archivo.size <= a.img_peso_max_kb * 1024 / 2) return sinCambios;

    let bitmap;
    try {
      bitmap = await crearBitmap(archivo);
    } catch (e) {
      console.warn('No se pudo procesar la imagen, subo la original:', e.message);
      return sinCambios;
    }

    const w0 = bitmap.width, h0 = bitmap.height;
    const factor = Math.min(1, a.img_ancho_max / w0, a.img_alto_max / h0);
    const w = Math.max(1, Math.round(w0 * factor));
    const h = Math.max(1, Math.round(h0 * factor));

    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d');
    lienzo.width = w;
    lienzo.height = h;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    try {
      // baja la calidad hasta cumplir el peso objetivo
      const objetivo = a.img_peso_max_kb * 1024;
      let calidad = a.img_calidad;
      let blob = null;

      for (let intento = 0; intento < 6; intento++) {
        blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', calidad));
        if (!blob) break;
        if (blob.size <= objetivo) break;
        calidad = Math.max(0.4, calidad - 0.12);
      }

      // si ni bajando calidad entra, achica un poco mas y reintenta
      if (blob && blob.size > objetivo) {
        const escala = Math.max(0.4, Math.sqrt(objetivo / blob.size) * 0.95);
        const w2 = Math.max(1, Math.round(w * escala));
        const h2 = Math.max(1, Math.round(h * escala));
        lienzo.width = w2;
        lienzo.height = h2;
        const ctx2 = lienzo.getContext('2d');
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(0, 0, w2, h2);
        ctx2.drawImage(bitmap, 0, 0, w2, h2);
        blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', calidad));
      }

      if (bitmap.close) bitmap.close();
      if (!blob || blob.size >= archivo.size) return sinCambios;

      const nombre = (archivo.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
      const nuevo = new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() });

      return {
        archivo: nuevo,
        info: { antes: archivo.size, despues: nuevo.size, ancho: lienzo.width, alto: lienzo.height }
      };
    } catch (e) {
      console.warn('Fallo la compresion, subo la original:', e.message);
      if (bitmap.close) bitmap.close();
      return sinCambios;
    }
  }

  /** Sube la foto ya comprimida. Devuelve { ruta, info }. */
  async function subirFoto(archivoOriginal) {
    const u = usuarioActual();
    if (!u) throw new Error('Tenés que iniciar sesión para subir una foto.');

    const problema = validarFoto(archivoOriginal);
    if (problema) throw new Error(problema);

    // achica la foto en el navegador antes de mandarla
    const { archivo, info } = await comprimirFoto(archivoOriginal);

    const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const ruta = u.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    const res = await fetch(URL_BASE + '/storage/v1/object/' + BUCKET + '/' + ruta, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': archivo.type,
        'x-upsert': 'false'
      },
      body: archivo
    });
    if (!res.ok) {
      throw errorLegible(await res.json().catch(() => ({})), res.status);
    }

    return {
      url: URL_BASE + '/storage/v1/object/public/' + BUCKET + '/' + ruta,
      info: info
    };
  }

  async function borrarFoto(url) {
    const u = usuarioActual();
    if (!u || !url) return;
    const prefijo = URL_BASE + '/storage/v1/object/public/' + BUCKET + '/';
    if (url.indexOf(prefijo) !== 0) return; // no es una foto de este bucket
    const ruta = decodeURIComponent(url.slice(prefijo.length));
    if (ruta.split('/')[0] !== u.id) return; // no es de este vendedor
    await fetch(URL_BASE + '/storage/v1/object/' + BUCKET + '/' + ruta, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token }
    }).catch(function () {});
  }

  // --------------------------------------------------------------------------
  //  Productos
  // --------------------------------------------------------------------------

  /** Trae los productos publicados por cualquiera + los ocultos del usuario. */
  async function listarProductos(filtros) {
    filtros = filtros || {};
    const u = usuarioActual();
    const condiciones = [];
    // siempre primero: esta web solo ve las publicaciones de su mercado
    condiciones.push('tienda=eq.' + encodeURIComponent(MI_TIENDA));
    if (filtros.categoria && filtros.categoria !== 'all') {
      condiciones.push('categoria=eq.' + encodeURIComponent(filtros.categoria));
    }
    if (!filtros.propios) {
      if (u) condiciones.push('or=(estado.eq.publicado,user_id.eq.' + u.id + ')');
      else condiciones.push('estado=eq.publicado');
    }
    if (filtros.buscar) {
      const q =encodeURIComponent('*' + filtros.buscar.trim() + '*');
      condiciones.push('or=(titulo.ilike.' + q + ',descripcion.ilike.' + q + ')');
    }
    condiciones.push('select=*,perfiles(nombre,telefono)');
    condiciones.push('order=created_at.desc');

    return api('/productos?' + condiciones.join('&')) || [];
  }

  async function listarMisProductos() {
    const u = usuarioActual();
    if (!u) return [];
    return api('/productos?user_id=eq.' + u.id +
               '&tienda=eq.' + encodeURIComponent(MI_TIENDA) +
               '&select=*,perfiles(nombre,telefono)&order=created_at.desc') || [];
  }

  async function crearProducto(datos) {
    const u = usuarioActual();
    if (!u) throw new Error('Tenés que iniciar sesión para publicar.');

    const titulo = String(datos.titulo || '').trim();
    if (!titulo) throw new Error('Poné un título para tu publicación.');
    if (!esCategoriaValida(datos.categoria)) throw new Error('Elegí una categoría válida.');

    const cuerpo = {
      user_id: u.id,
      titulo: titulo.slice(0, 120),
      descripcion: String(datos.descripcion || '').trim().slice(0, 2000),
      precio: String(datos.precio || '').trim().slice(0, 40),
      categoria: datos.categoria,
      foto_url: datos.foto_url || null,
      estado: datos.estado === 'oculto' ? 'oculto' : 'publicado',
      tienda: MI_TIENDA
    };

    const res = await api('/productos', {
      method: 'POST', body: cuerpo, prefer: 'return=representation'
    });
    return res && res[0];
  }

  async function actualizarProducto(id, datos) {
    const u = usuarioActual();
    if (!u) throw new Error('No hay sesión');
    const patch = {};
    if (datos.titulo !== undefined) patch.titulo = String(datos.titulo).trim().slice(0, 120);
    if (datos.descripcion !== undefined) patch.descripcion = String(datos.descripcion).trim().slice(0, 2000);
    if (datos.precio !== undefined) patch.precio = String(datos.precio).trim().slice(0, 40);
    if (datos.categoria !== undefined && esCategoriaValida(datos.categoria)) patch.categoria = datos.categoria;
    if (datos.foto_url !== undefined) patch.foto_url = datos.foto_url;
    if (datos.estado !== undefined) patch.estado = datos.estado === 'oculto' ? 'oculto' : 'publicado';

    const res = await api('/productos?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH', body: patch, prefer: 'return=representation'
    });
    return res && res[0];
  }

  async function alternarEstado(id, estadoActual) {
    return actualizarProducto(id, { estado: estadoActual === 'publicado' ? 'oculto' : 'publicado' });
  }

  async function borrarProducto(id) {
    const u = usuarioActual();
    if (!u) throw new Error('No hay sesión');
    const productos = await listarMisProductos();
    const p = productos.find(x => x.id === id);
    if (p) await borrarFoto(p.foto_url);
    await api('/productos?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // --------------------------------------------------------------------------
  //  Export
  // --------------------------------------------------------------------------
  const Tienda = {
    configOk: configOk,
      CATEGORIAS: CATS,
    TIENDA: MI_TIENDA,
    NOMBRE: NOMBRE,

    escapeHtml: escapeHtml,
    normalizarWhatsApp: normalizarWhatsApp,
    linkWhatsApp: linkWhatsApp,
    etiquetaCategoria: etiquetaCategoria,

    restaurarSesion: restaurarSesion,
    onAuthChange: onAuthChange,
    usuarioActual: usuarioActual,
    estaLogueado: function () { return !!session; },
    registrar: registrar,
    iniciarSesion: iniciarSesion,
    tomarPendientes: tomarPendientes,
    cerrarSesion: cerrarSesion,

    obtenerPerfil: obtenerPerfil,
    actualizarPerfil: actualizarPerfil,
    asegurarPerfil: asegurarPerfil,

    ajustes: ajustes,
    validarFoto: validarFoto,
    comprimirFoto: comprimirFoto,
    subirFoto: subirFoto,
    borrarFoto: borrarFoto,

    listarProductos: listarProductos,
    listarMisProductos: listarMisProductos,
    crearProducto: crearProducto,
    actualizarProducto: actualizarProducto,
    alternarEstado: alternarEstado,
    borrarProducto: borrarProducto
  };

  global.Tienda = Tienda;
})(window);
