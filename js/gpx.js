'use strict';

/**
 * GPX-Export: berechnete Wegstrecke als <trk>, POIs als <wpt>.
 */
const Gpx = {
  /**
   * @param {Array<{lat:number, lng:number, ele?:number}>|null} trackPoints
   * @param {Array<{lat:number, lng:number, name:string, note:string}>} pois
   * @returns {string} GPX-1.1-Dokument
   */
  build(trackPoints, pois) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Wanderplaner" xmlns="http://www.topografix.com/GPX/1/1">',
      '  <metadata>',
      '    <name>Wanderroute</name>',
      `    <time>${new Date().toISOString()}</time>`,
      '  </metadata>',
    ];

    for (const poi of pois) {
      lines.push(`  <wpt lat="${poi.lat.toFixed(6)}" lon="${poi.lng.toFixed(6)}">`);
      lines.push(`    <name>${Utils.escapeXml(poi.name)}</name>`);
      if (poi.note) {
        lines.push(`    <desc>${Utils.escapeXml(poi.note)}</desc>`);
      }
      lines.push('  </wpt>');
    }

    if (trackPoints && trackPoints.length > 0) {
      lines.push('  <trk>');
      lines.push('    <name>Wanderroute</name>');
      lines.push('    <trkseg>');
      for (const pt of trackPoints) {
        const open = `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">`;
        if (pt.ele != null) {
          lines.push(`${open}<ele>${pt.ele.toFixed(1)}</ele></trkpt>`);
        } else {
          lines.push(`${open}</trkpt>`);
        }
      }
      lines.push('    </trkseg>');
      lines.push('  </trk>');
    }

    lines.push('</gpx>');
    return lines.join('\n');
  },

  /** Löst den Browser-Download der GPX-Datei aus. */
  download(trackPoints, pois) {
    const gpx = this.build(trackPoints, pois);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `_${pad(now.getHours())}-${pad(now.getMinutes())}`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wanderroute_${stamp}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
