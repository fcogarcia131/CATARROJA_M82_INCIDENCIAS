const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRR0zXeaD3_kNR0twc8r9cMJ2Tve6zdrs3jg4edg2k8bR1nIN1p6aYU_5B4YV-CrDA-zhB4MXCf7i4B/pub?gid=1293854772&single=true&output=csv';
const GVIZ_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRR0zXeaD3_kNR0twc8r9cMJ2Tve6zdrs3jg4edg2k8bR1nIN1p6aYU_5B4YV-CrDA-zhB4MXCf7i4B/gviz/tq?gid=1293854772';
const LOCAL_API_URL = '/api/incidencias';

const body = document.querySelector('#incidentsBody');
const emptyState = document.querySelector('#emptyState');
const search = document.querySelector('#searchInput');
const refreshButton = document.querySelector('#refreshButton');
const statusFilter = document.querySelector('#statusFilter');
const parameterFilter = document.querySelector('#parameterFilter');
const ownerFilter = document.querySelector('#ownerFilter');
const fromDate = document.querySelector('#fromDate');
const toDate = document.querySelector('#toDate');
let incidents = [];

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = {
  date: ['fechaincidencia','fecha','fechaevento','fechaapertura','incidenciafecha'],
  owner: ['responsablemedicion','responsableincidencia','responsable','tecnico','operario','persona','responsablecorreccion'],
  parameter: ['tipoincidencia','parametroafectado','parametro','concepto','elemento'],
  element: ['elemento','elementoafectado','equipo','ubicacion'],
  value: ['valordetectado','valordesviado','valordesviacion','valormedido','valorregistrado','valor','desviacion','descripcion'],
  status: ['estado','situacion','estatus','estadoincidencia'],
  correctionDate: ['fechacorreccion','fechadecorreccion','fechacierre','fecharesolucion','fechaaccioncorrectiva'],
  correctiveAction: ['accioncorrectorapropuesta','accioncorrectivarealizada','accioncorrectora','accioncorrectiva','accionrealizada','accion']
};

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const headers = rows.shift().map(normalize);
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

// La consulta de visualización se carga como un script de Google. Así no queda
// bloqueada por la política CORS al abrir este informe como un archivo local.
function loadGoogleSheet() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('La hoja de cálculo ha tardado demasiado en responder.')), 15000);
    const script = document.createElement('script');
    const previousGoogle = window.google;
    let complete = false;
    const finish = (error, data) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      script.remove();
      if (previousGoogle) window.google = previousGoogle; else delete window.google;
      error ? reject(error) : resolve(data);
    };
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    window.google.visualization.Query.setResponse = (response) => {
      if (response.status !== 'ok') return finish(new Error('Google Sheets ha devuelto una respuesta no válida.'));
      const table = response.table;
      const headers = table.cols.map(column => normalize(column.label || column.id));
      finish(null, table.rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row.c[index]?.f ?? row.c[index]?.v ?? '']))));
    };
    script.onerror = () => finish(new Error('No se ha podido conectar con la hoja publicada.'));
    script.src = `${GVIZ_URL}&tqx=out:json&t=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function field(record, key) {
  const names = Object.keys(record);
  const header = aliases[key]
    .map(alias => names.find(name => name === alias || name.includes(alias)))
    .find(Boolean);
  return header ? record[header] : '';
}

function isResolved(value) { return /correg|resuelt|cerrad|complet|finaliz/i.test(value); }
function statusClass(value) { return isResolved(value) ? 'resolved' : value ? 'open' : 'other'; }
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = value || '—'; return div.innerHTML; }

function toDateValue(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : '';
}

function fillSelect(select, values, label) {
  const selected = select.value;
  select.innerHTML = `<option value="">${label}</option>` + [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')).map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join('');
  select.value = selected;
}

function populateFilters() {
  fillSelect(statusFilter, incidents.map(item => item.status), 'Todos los estados');
  fillSelect(parameterFilter, incidents.map(item => item.parameter), 'Todos los parámetros');
  fillSelect(ownerFilter, incidents.map(item => item.owner), 'Todos los responsables');
}

function render() {
  const term = normalize(search.value);
  let visible = incidents.filter(item => {
    const date = toDateValue(item.date);
    return normalize(Object.values(item).join(' ')).includes(term)
      && (!statusFilter.value || item.status === statusFilter.value)
      && (!parameterFilter.value || item.parameter === parameterFilter.value)
      && (!ownerFilter.value || item.owner === ownerFilter.value)
      && (!fromDate.value || (date && date >= fromDate.value))
      && (!toDate.value || (date && date <= toDate.value));
  });

  visible.sort((a, b) => {

    const fechaA = toDateValue(a.date);
    const fechaB = toDateValue(b.date);

    if (!fechaA) return 1;
    if (!fechaB) return -1;

    return fechaB.localeCompare(fechaA);

});
  body.innerHTML = visible.map(item => `<tr>
    <td>${escapeHTML(item.date)}</td><td>${escapeHTML(item.owner)}</td><td>${escapeHTML(item.parameter)}</td><td>${escapeHTML(item.element)}</td>
    <td>${escapeHTML(item.value)}</td><td><span class="status status--${statusClass(item.status)}">${escapeHTML(item.status || 'Sin definir')}</span></td>
    <td>${escapeHTML(item.correctionDate)}</td><td>${isResolved(item.status) ? escapeHTML(item.correctiveAction) : '—'}</td></tr>`).join('');
  emptyState.hidden = visible.length !== 0;
  const total = visible.length, resolved = visible.filter(item => isResolved(item.status)).length;
  document.querySelector('#totalCount').textContent = total;
  document.querySelector('#resolvedCount').textContent = resolved;
  document.querySelector('#openCount').textContent = total - resolved;
  document.querySelector('#resolutionRate').textContent = total ? `${Math.round(resolved / total * 100)}%` : '—';
}

async function loadData() {
  refreshButton.disabled = true; body.innerHTML = document.querySelector('#loadingRow').innerHTML; emptyState.hidden = true;
  try {
    let records;
    // Mismo método de carga que usa la página de referencia del proyecto.
    try {
      const response = await fetch(`${CSV_URL}&t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Google Sheets ha respondido con el código ${response.status}.`);
      records = parseCSV(await response.text());
    }
    catch {
      try { records = await loadGoogleSheet(); }
      catch { throw new Error('La pestaña de incidencias no está publicada para lectura web.'); }
    }
    incidents = records.map(record => ({ date: field(record, 'date'), owner: field(record, 'owner'), parameter: field(record, 'parameter'), element: field(record, 'element'), value: field(record, 'value'), status: field(record, 'status'), correctionDate: field(record, 'correctionDate'), correctiveAction: field(record, 'correctiveAction') })).filter(item => Object.values(item).some(Boolean));
    populateFilters();
    render();
    document.querySelector('#updatedAt').textContent = `Última actualización: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())}`;
  } catch (error) {
    body.innerHTML = `<tr><td colspan="8" class="loading">${escapeHTML(error.message)} Vuelve a intentarlo en unos momentos.</td></tr>`;
    document.querySelector('#updatedAt').textContent = 'No se han podido actualizar los datos.';
  } finally { refreshButton.disabled = false; }
}
search.addEventListener('input', render);
[statusFilter, parameterFilter, ownerFilter, fromDate, toDate].forEach(control => control.addEventListener('change', render));
document.querySelector('#clearFilters').addEventListener('click', () => { search.value = ''; statusFilter.value = ''; parameterFilter.value = ''; ownerFilter.value = ''; fromDate.value = ''; toDate.value = ''; render(); });
refreshButton.addEventListener('click', loadData);
loadData();
// Mantiene el informe sincronizado incluso si queda abierto en una pantalla de seguimiento.
setInterval(loadData, 5 * 60 * 1000);
