// ============================================================================
//  Concaran Market - Configuración de Supabase
//
//  ATENCIÓN: este archivo es una COPIA del de Tilisarao, y a propósito.
//
//  Los dos mercados usan la MISMA base de datos y el mismo bucket de fotos.
//  La única diferencia entre ellos es la constante TIENDA del final:
//  filtrando por esa columna, Tilisarao solo ve publicaciones de Tilisarao
//  y Concaran solo ve publicaciones de Concaran. Los vendedores pueden
//  tener cuenta en los dos pueblos con el mismo correo.
//
//  Si alguna vez hay que cambiar las claves o el bucket, se cambian en los
//  dos archivos (o en el de Tilisarao y se copia acá).
// ============================================================================

// Dónde sacarlos:
//   Supabase Dashboard > Project Settings > API
//     - Project URL       -> SUPABASE_URL
//     - anon public key   -> SUPABASE_ANON_KEY
//
//  La "anon public key" está pensado para ir en el navegador: no es un secreto.
//  Lo que protege los datos son las políticas RLS del archivo supabase-setup.sql.
const SUPABASE_URL = 'https://zzzkeshmhoubzeysaarm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HVEaKb7bPBMKiCHZZ0RdFg_6-wyslaz';

// El bucket de Storage donde se suben las fotos de los productos.
// Es el mismo que en Tilisarao: las fotos viven una sola vez.
const SUPABASE_BUCKET = 'fotos-productos';

// ---------------------------------------------------------------------------
//  ESTA ES LA ÚNICA LÍNEA QUE DEFINE A QUÉ MERCADO PERTENECE ESTA WEB.
//  Minúsculas, sin tildes y sin espacios.
//  Para agregar un mercado nuevo: se copia esta carpeta, se cambia este
//  valor por el nombre del pueblo y ya está. No hay que tocar la base.
// ---------------------------------------------------------------------------
const TIENDA = 'concaran';

// Nombre que ve el comprador: título de las tarjetas y texto del mensaje
// de WhatsApp. Acá va el nombre del mercado, con mayúsculas y tildes.
const NOMBRE_TIENDA = 'Concarán Market';

// Categorías. Deben coincidir con el <select> del index.html y con el CHECK de
// la tabla productos en supabase-setup.sql.
const CATEGORIAS = [
  { value: 'vehiculos', label: 'Vehículos' },
  { value: 'inmuebles', label: 'Inmuebles' },
  { value: 'telefonos', label: 'Teléfonos' },
  { value: 'electronica', label: 'Electrónica' },
  { value: 'moda', label: 'Ropa y moda' },
  { value: 'hogar', label: 'Hogar y jardín' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'otros', label: 'Otros' }
];
