// Catalogue des badges débloquables.
// Chaque badge a un id unique, un nom, une icône (emoji) et un pattern qui matche
// les titres de films associés. Le tableau est parcouru dans l'ordre, donc place
// les badges spécifiques avant le catch-all.

const BADGES = [
  {
    id: 'spiderman',
    name: 'Tisseur de toile',
    icon: '🕷️',
    color: '#c4111e',
    accent: '#1a4ba0',
    description: 'Tu as suivi les aventures de l\'homme-araignée.',
    match: /spider.?man/,
  },
  {
    id: 'mario',
    name: 'Plombier du Royaume Champignon',
    icon: '🍄',
    color: '#e52521',
    accent: '#fbd000',
    description: 'Mamma mia ! Tu as exploré le Royaume Champignon.',
    match: /\bmario\b/,
  },
  {
    id: 'batman',
    name: 'Chevalier noir',
    icon: '🦇',
    color: '#1a1a1a',
    accent: '#f0c040',
    description: 'Gotham peut compter sur toi.',
    match: /batman|dark.?knight/,
  },
  {
    id: 'starwars',
    name: 'Apprenti Jedi',
    icon: '⚔️',
    color: '#0a0a0a',
    accent: '#3aafff',
    description: 'Que la Force soit avec toi.',
    match: /star.?wars|jedi|sith|skywalker|mandalorian|rogue.?one/,
  },
  {
    id: 'harrypotter',
    name: 'Sorcier de Poudlard',
    icon: '⚡',
    color: '#6b1f20',
    accent: '#d4af37',
    description: 'Tu as franchi les portes de Poudlard.',
    match: /harry.?potter|hogwarts|fantastic.?beasts/,
  },
  {
    id: 'marvel',
    name: 'Avenger',
    icon: '🛡️',
    color: '#ed1d24',
    accent: '#000000',
    description: 'Tu as rejoint les héros les plus puissants de la Terre.',
    match: /iron.?man|avengers|thor|captain.?america|black.?panther|doctor.?strange|guardians/,
  },
  {
    id: 'pixar',
    name: 'Rêveur Pixar',
    icon: '✨',
    color: '#0099ff',
    accent: '#ffe600',
    description: 'Tu as plongé dans la magie des studios Pixar.',
    match: /frozen|encanto|moana|toy.?story|coco|inside.?out|ratatouille|wall.?e/,
  },
  {
    id: 'jurassic',
    name: 'Survivant du Jurassic',
    icon: '🦖',
    color: '#2d6b1a',
    accent: '#d4a020',
    description: 'Tu as échappé aux dinosaures.',
    match: /jurassic|dinosaur/,
  },
  {
    id: 'horror',
    name: 'Âme courageuse',
    icon: '🔪',
    color: '#3a0008',
    accent: '#9c1010',
    description: 'Tu as affronté tes plus grandes peurs.',
    match: /horror|scream|conjuring|insidious|halloween|chucky|annabelle/,
  },
  {
    id: 'animation',
    name: 'Petit prince du dessin animé',
    icon: '🎨',
    color: '#ff4f8b',
    accent: '#3acef2',
    description: 'Une séance d\'animation à ton actif.',
    match: /shrek|kung.?fu.?panda|madagascar|minions|despicable|ice.?age/,
  },
  // Catch-all : badge offert pour tout film qui ne matche aucun thème spécifique
  {
    id: 'cinephile',
    name: 'Cinéphile',
    icon: '🎬',
    color: '#2a2a2a',
    accent: '#d4a017',
    description: 'Une nouvelle séance ajoutée à ta collection.',
    match: /.*/,
  },
];

function findBadgeForFilm(filmTitle) {
  const t = String(filmTitle || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return BADGES.find(b => b.match.test(t)) || null;
}

module.exports = { BADGES, findBadgeForFilm };
