// EXPORTAR REPORTES: genera un archivo Excel (.xlsx) o PDF real a partir de una tabla.
// Lo usan los reportes de ventas, inventario y la bitácora.
//
//   reporte = {
//     titulo, subtitulo, papeleria,
//     resumen:  [{ etiqueta, valor }],                     // tarjetas de arriba (opcional)
//     columnas: [{ titulo, clave, tipo: 'texto'|'numero'|'dinero'|'fecha', ancho }],
//     filas:    [{ ...valores por clave }],
//     totales:  { clave: valor },                         // renglón final (opcional)
//     nota,                                                // texto al pie (opcional)
//   }
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const AZUL = '1F4E79';
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaTexto = (f) => new Date(f).toLocaleString('es-MX', { timeZone: process.env.TZ_REPORTES || 'America/Tijuana' });

function texto(valor, tipo) {
  if (valor === null || valor === undefined) return '';
  if (tipo === 'dinero') return dinero(valor);
  if (tipo === 'numero') return Number(valor).toLocaleString('es-MX');
  if (tipo === 'fecha') return fechaTexto(valor);
  return String(valor);
}

async function excel(r) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'CRCASA';
  libro.created = new Date();
  const hoja = libro.addWorksheet(r.hoja || 'Reporte', { views: [{ state: 'frozen', ySplit: 0 }] });
  const n = r.columnas.length;

  hoja.mergeCells(1, 1, 1, n);
  hoja.getCell(1, 1).value = `${r.papeleria || 'CRCASA'} · ${r.titulo}`;
  hoja.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF' + AZUL } };
  hoja.mergeCells(2, 1, 2, n);
  hoja.getCell(2, 1).value = r.subtitulo || '';
  hoja.getCell(2, 1).font = { italic: true, color: { argb: 'FF555555' } };

  let fila = 4;
  for (const x of r.resumen || []) {
    hoja.getCell(fila, 1).value = x.etiqueta;
    hoja.getCell(fila, 1).font = { bold: true };
    hoja.getCell(fila, 2).value = x.valor;
    if (x.tipo === 'dinero') hoja.getCell(fila, 2).numFmt = '"$"#,##0.00';
    fila++;
  }
  if (r.resumen && r.resumen.length) fila++;

  const filaEnc = fila;
  r.columnas.forEach((c, i) => {
    const celda = hoja.getCell(fila, i + 1);
    celda.value = c.titulo;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + AZUL } };
    celda.alignment = { horizontal: c.tipo === 'texto' || !c.tipo ? 'left' : 'right' };
    hoja.getColumn(i + 1).width = c.ancho || 16;
  });
  hoja.views = [{ state: 'frozen', ySplit: filaEnc }];

  for (const f of r.filas) {
    fila++;
    r.columnas.forEach((c, i) => {
      const celda = hoja.getCell(fila, i + 1);
      const v = f[c.clave];
      if (c.tipo === 'dinero' || c.tipo === 'numero') celda.value = v === null || v === undefined || v === '' ? null : Number(v);
      else if (c.tipo === 'fecha') celda.value = v ? new Date(v) : null;
      else celda.value = v === null || v === undefined ? '' : String(v);
      if (c.tipo === 'dinero') celda.numFmt = '"$"#,##0.00';
      if (c.tipo === 'fecha') celda.numFmt = 'dd/mm/yyyy hh:mm';
      if (c.tipo === 'texto' || !c.tipo) celda.alignment = { wrapText: true, vertical: 'top' };
    });
  }
  if (r.filas.length) hoja.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: fila, column: n } };

  if (r.totales) {
    fila++;
    r.columnas.forEach((c, i) => {
      const celda = hoja.getCell(fila, i + 1);
      const v = r.totales[c.clave];
      // Las sumas quedan como fórmula para que el archivo siga cuadrando si alguien edita una celda
      if (v === 'SUMA' && r.filas.length) {
        const letra = hoja.getColumn(i + 1).letter;
        celda.value = { formula: `SUM(${letra}${filaEnc + 1}:${letra}${fila - 1})` };
      } else celda.value = v ?? '';
      if (c.tipo === 'dinero') celda.numFmt = '"$"#,##0.00';
      celda.font = { bold: true };
      celda.border = { top: { style: 'thin' } };
    });
  }
  if (r.nota) {
    fila += 2;
    hoja.mergeCells(fila, 1, fila, n);
    hoja.getCell(fila, 1).value = r.nota;
    hoja.getCell(fila, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

// Valor que se imprime en el renglón de totales del PDF (las fórmulas se calculan aquí)
function totalPdf(r, c) {
  const v = r.totales[c.clave];
  if (v !== 'SUMA') return v ?? '';
  return texto(r.filas.reduce((s, f) => s + Number(f[c.clave] || 0), 0), c.tipo);
}

function pdf(r) {
  return new Promise((resolve, reject) => {
    const horizontal = r.columnas.length > 5;
    const doc = new PDFDocument({ size: 'LETTER', layout: horizontal ? 'landscape' : 'portrait', margin: 40, bufferPages: true,
      info: { Title: r.titulo, Author: r.papeleria || 'CRCASA' } });
    const partes = [];
    doc.on('data', (b) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const izq = doc.page.margins.left;
    const anchoUtil = doc.page.width - izq - doc.page.margins.right;
    const pesos = r.columnas.map((c) => c.ancho || 16);
    const suma = pesos.reduce((a, b) => a + b, 0);
    const anchos = pesos.map((p) => (p / suma) * anchoUtil);
    const abajo = () => doc.page.height - doc.page.margins.bottom - 20;

    // Encabezado
    doc.rect(izq, 40, anchoUtil, 4).fill('#' + AZUL);
    doc.fillColor('#' + AZUL).font('Helvetica-Bold').fontSize(16).text(r.papeleria || 'CRCASA', izq, 52);
    doc.fillColor('#000').fontSize(12).text(r.titulo);
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(r.subtitulo || '');
    doc.moveDown(0.6);

    // Resumen en recuadros
    if (r.resumen && r.resumen.length) {
      const y = doc.y;
      const w = anchoUtil / r.resumen.length;
      r.resumen.forEach((x, i) => {
        const xx = izq + i * w;
        doc.roundedRect(xx + 2, y, w - 4, 40, 4).fillAndStroke('#F2F6FA', '#C9D6E3');
        doc.fillColor('#555').font('Helvetica').fontSize(8).text(x.etiqueta, xx + 8, y + 6, { width: w - 16 });
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(13)
          .text(x.tipo === 'dinero' ? dinero(x.valor) : String(x.valor), xx + 8, y + 19, { width: w - 16 });
      });
      doc.y = y + 50;
    }

    const encabezado = () => {
      const y = doc.y;
      doc.rect(izq, y, anchoUtil, 18).fill('#' + AZUL);
      let x = izq;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
      r.columnas.forEach((c, i) => {
        const der = c.tipo === 'dinero' || c.tipo === 'numero';
        doc.text(c.titulo, x + 4, y + 5, { width: anchos[i] - 8, align: der ? 'right' : 'left', lineBreak: false });
        x += anchos[i];
      });
      doc.y = y + 18;
    };

    const renglon = (valores, { negrita = false, fondo = null } = {}) => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const alto = Math.max(16, ...valores.map((v, i) => doc.heightOfString(v, { width: anchos[i] - 8 }) + 8));
      if (doc.y + alto > abajo()) { doc.addPage(); doc.y = doc.page.margins.top; encabezado(); doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5); }
      const y = doc.y;
      if (fondo) doc.rect(izq, y, anchoUtil, alto).fill(fondo);
      let x = izq;
      doc.fillColor('#000');
      valores.forEach((v, i) => {
        const c = r.columnas[i];
        const der = c.tipo === 'dinero' || c.tipo === 'numero';
        doc.text(v, x + 4, y + 4, { width: anchos[i] - 8, align: der ? 'right' : 'left' });
        x += anchos[i];
      });
      doc.moveTo(izq, y + alto).lineTo(izq + anchoUtil, y + alto).lineWidth(0.5).strokeColor('#DDD').stroke();
      doc.y = y + alto;
    };

    encabezado();
    if (!r.filas.length) renglon(r.columnas.map((c, i) => (i === 0 ? 'Sin registros en el periodo' : '')));
    r.filas.forEach((f, k) => renglon(r.columnas.map((c) => texto(f[c.clave], c.tipo)), { fondo: k % 2 ? '#F7F9FB' : null }));
    if (r.totales) renglon(r.columnas.map((c) => String(totalPdf(r, c))), { negrita: true, fondo: '#E8EEF5' });

    if (r.nota) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666').text(r.nota, izq, doc.y, { width: anchoUtil });
    }

    // Pie de página en cada hoja: fecha de generación y número de página
    const generado = `Generado el ${fechaTexto(new Date())} · CRCASA`;
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // si no, pdfkit agrega una hoja al escribir en el margen
      const y = doc.page.height - 30;
      doc.font('Helvetica').fontSize(7.5).fillColor('#888');
      doc.text(generado, izq, y, { width: anchoUtil / 2, lineBreak: false });
      doc.text(`Página ${i + 1} de ${rango.count}`, izq + anchoUtil / 2, y, { width: anchoUtil / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

// Responde el archivo para que el navegador lo descargue
async function enviar(res, formato, reporte, nombreBase) {
  if (formato === 'xlsx') {
    const buf = await excel(reporte);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${nombreBase}.xlsx"`);
    return res.send(buf);
  }
  const buf = await pdf(reporte);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${nombreBase}.pdf"`);
  return res.send(buf);
}

module.exports = { excel, pdf, enviar, dinero };
