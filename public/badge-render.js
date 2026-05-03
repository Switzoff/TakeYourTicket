// Rendu d'un badge en médaillon SVG style "sceau cranté".
// Utilisé sur la page de scan-animation, le profil et le profil public.
//
// renderBadge(badge, opts) → string SVG
//   badge : { id, name, icon, color, accent, description? }
//   opts.size : taille en px (défaut 200)
//   opts.withText : afficher le nom du badge sur l'anneau (défaut true)

(function () {
  function serratedPath(cx, cy, rOut, rIn, teeth) {
    const step = (Math.PI * 2) / (teeth * 2);
    let d = '';
    for (let i = 0; i < teeth * 2; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = i * step - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
    }
    return d + 'Z';
  }

  function escapeXml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[c]));
  }

  window.renderBadge = function (badge, opts) {
    opts = opts || {};
    const size = opts.size || 200;
    const withText = opts.withText !== false;

    const VB = 200;            // viewBox interne (on scale via width/height)
    const cx = VB / 2, cy = VB / 2;
    const rOut = 98, rIn = 89; // bord cranté
    const teeth = 28;
    const ringWidth = 22;
    const ringR = rIn - ringWidth / 2 - 2;       // rayon du milieu de l'anneau coloré
    const innerR = ringR - ringWidth / 2 - 2;     // rayon du disque central
    // Rayon pour le textPath : centré dans l'anneau
    const textR = ringR;

    const color = badge.color || '#2a2a2a';
    const accent = badge.accent || '#d4a017';
    const name = (badge.name || '').toUpperCase();
    const icon = badge.icon || '🎬';

    // Filet sombre cranté + anneau coloré + filet intérieur + disque central + icône
    // textPath qui démarre en haut et fait le tour
    const uid = 'b' + Math.random().toString(36).slice(2, 8);
    const arcPath = `M ${cx},${cy} m 0,-${textR} a ${textR},${textR} 0 1,1 0,${textR * 2} a ${textR},${textR} 0 1,1 0,-${textR * 2}`;

    const text = withText ? `
      <defs>
        <path id="ring-${uid}" d="${arcPath}" />
      </defs>
      <text fill="#fff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
            font-size="11" font-weight="800" letter-spacing="2.5">
        <textPath href="#ring-${uid}" startOffset="25%" text-anchor="middle">${escapeXml(name)}</textPath>
      </text>
    ` : '';

    return `
      <svg viewBox="0 0 ${VB} ${VB}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <!-- Bord cranté noir (fond sticker) -->
        <path d="${serratedPath(cx, cy, rOut, rIn, teeth)}" fill="#0a0a0a"/>
        <!-- Liseré sombre intérieur -->
        <circle cx="${cx}" cy="${cy}" r="${rIn - 1}" fill="${color}" stroke="#000" stroke-width="1.5"/>
        <!-- Anneau coloré -->
        <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${accent}" stroke-width="${ringWidth}"/>
        <!-- Filets fins en haut/bas de l'anneau pour le contraste -->
        <circle cx="${cx}" cy="${cy}" r="${ringR + ringWidth/2}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <circle cx="${cx}" cy="${cy}" r="${ringR - ringWidth/2}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <!-- Disque central -->
        <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${color}" />
        <!-- Reflet -->
        <ellipse cx="${cx - innerR*0.25}" cy="${cy - innerR*0.5}" rx="${innerR*0.55}" ry="${innerR*0.22}"
                 fill="rgba(255,255,255,0.08)" />
        <!-- Icône -->
        <text x="${cx}" y="${cy + innerR*0.18}" font-size="${innerR * 1.15}" text-anchor="middle"
              dominant-baseline="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI Emoji', sans-serif">
          ${escapeXml(icon)}
        </text>
        ${text}
      </svg>
    `;
  };
})();
