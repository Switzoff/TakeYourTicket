const admin = require('firebase-admin');

const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ADMIN_UIDS = (process.env.ADMIN_UIDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.token = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!ADMIN_UIDS.includes(req.uid)) {
      return res.status(403).json({ error: 'Accès admin requis' });
    }
    next();
  });
}

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { findBadgeForFilm } = require('./badges');

const app = express();
const TMDB_API_KEY = '6ab36cec6d539dc145a762e4d15524f3';
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.post('/api/generer-tickets', requireAdmin, async (req, res) => {
  const { film, cinema, date, holo } = req.body;
  const quantite = parseInt(req.body.quantite, 10);
  if (!film || !cinema || !date) {
    return res.status(400).json({ error: 'film, cinema, date requis' });
  }
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 500) {
    return res.status(400).json({ error: 'quantite doit être entre 1 et 500' });
  }
  if (String(film).length > 200 || String(cinema).length > 200) {
    return res.status(400).json({ error: 'film/cinema trop long' });
  }
  const ticketsGeneres = [];
  for (let i = 0; i < quantite; i++) {
    const id = uuidv4();
    await db.collection('tickets').doc(id).set({
      id, film, cinema, date, scanne: false, proprietaire: null, holo: !!holo
    });
    ticketsGeneres.push(id);
  }
  res.json({ succes: true, tickets: ticketsGeneres });
});

// Le QR du ticket pointe ici. On redirige vers la page client qui se chargera
// d'appeler /api/scan/:id avec un token authentifié.
app.get('/scan/:id', (req, res) => {
  res.redirect(`/scan-page/${req.params.id}`);
});

// Scan authentifié : marque le ticket scanné et l'ajoute à la collection de l'utilisateur connecté.
app.post('/api/scan/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const ref = db.collection('tickets').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Ticket invalide' });
  const ticket = doc.data();
  if (ticket.scanne) return res.status(409).json({ error: 'Ticket déjà scanné' });
  await ref.update({ scanne: true, proprietaire: req.uid });
  await db.collection('collections').add({
    uid: req.uid,
    film: ticket.film,
    cinema: ticket.cinema,
    date: ticket.date,
    ticketId: id,
    holo: ticket.holo || false,
    createdAt: new Date()
  });

  // Attribution automatique d'un badge selon le film, en évitant les doublons
  let unlockedBadge = null;
  const badge = findBadgeForFilm(ticket.film);
  if (badge) {
    const profileRef = db.collection('profiles').doc(req.uid);
    const profileDoc = await profileRef.get();
    const existing = profileDoc.exists ? (profileDoc.data().badges || []) : [];
    if (!existing.some(b => b.id === badge.id)) {
      const newBadge = {
        id: badge.id,
        name: badge.name,
        icon: badge.icon,
        color: badge.color || '#2a2a2a',
        accent: badge.accent || '#d4a017',
        description: badge.description,
        ticketId: id,
        filmTitle: ticket.film,
        unlockedAt: new Date().toISOString(),
      };
      await profileRef.set({
        badges: admin.firestore.FieldValue.arrayUnion(newBadge),
      }, { merge: true });
      unlockedBadge = newBadge;
    }
  }

  res.json({ success: true, film: ticket.film, holo: !!ticket.holo, badge: unlockedBadge });
});

app.get('/collection', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/affiche/:film', async (req, res) => {
  const film = req.params.film;
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(film)}&language=fr-FR`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.results && data.results[0] && data.results[0].poster_path) {
    res.json({ affiche: `https://image.tmdb.org/t/p/original${data.results[0].poster_path}` });
  } else {
    res.json({ affiche: null });
  }
});

app.get('/api/recherche-films', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=fr-FR&page=1`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    const results = (data.results || []).slice(0, 12).map(r => ({
      id: r.id,
      title: r.title,
      year: r.release_date ? String(r.release_date).slice(0, 4) : '',
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
    }));
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// Fiche détaillée d'un film (synopsis + casting + backdrop) pour la page Collection
app.get('/api/film-details', async (req, res) => {
  const title = (req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title requis' });
  try {
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=fr-FR`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const movie = (searchData.results || [])[0];
    if (!movie) return res.json({});

    const [detailsRes, creditsRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&language=fr-FR`),
      fetch(`https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${TMDB_API_KEY}&language=fr-FR`),
    ]);
    const details = await detailsRes.json();
    const credits = await creditsRes.json();

    res.json({
      id: details.id,
      title: details.title || '',
      tagline: details.tagline || '',
      overview: details.overview || '',
      releaseDate: details.release_date || '',
      runtime: details.runtime || null,
      genres: (details.genres || []).map(g => g.name),
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
      backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : null,
      cast: (credits.cast || []).slice(0, 8).map(c => ({
        name: c.name,
        character: c.character,
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      })),
    });
  } catch (e) {
    res.json({});
  }
});

// Proxy d'images TMDB pour contourner le CORS lors du téléchargement (html2canvas)
app.get('/api/proxy-image', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url.startsWith('https://image.tmdb.org/')) {
    return res.status(400).json({ error: 'URL non autorisée' });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = await r.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/collections', requireAuth, async (req, res) => {
  const snapshot = await db.collection('collections').where('uid', '==', req.uid).get();
  const tickets = snapshot.docs.map(doc => doc.data());
  res.json(tickets);
});

app.get('/api/profile', requireAuth, async (req, res) => {
  const doc = await db.collection('profiles').doc(req.uid).get();
  if (!doc.exists) return res.json({});
  res.json(doc.data());
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const { displayName, photoURL, favoriteFilms, favoriteActors, favoriteQuotes } = req.body;
  const data = { updatedAt: new Date() };
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.length > 60) {
      return res.status(400).json({ error: 'displayName invalide' });
    }
    data.displayName = displayName;
    data.displayNameLower = displayName.toLowerCase();
  }
  if (photoURL !== undefined) {
    if (typeof photoURL !== 'string' || photoURL.length > 500000) {
      return res.status(400).json({ error: 'photoURL invalide' });
    }
    data.photoURL = photoURL;
  }
  if (Array.isArray(favoriteFilms)) {
    if (favoriteFilms.length > 50) return res.status(400).json({ error: 'trop de films' });
    data.favoriteFilms = favoriteFilms;
  }
  if (Array.isArray(favoriteActors)) {
    if (favoriteActors.length > 50) return res.status(400).json({ error: 'trop d\'acteurs' });
    data.favoriteActors = favoriteActors;
  }
  if (Array.isArray(favoriteQuotes)) {
    if (favoriteQuotes.length > 50) return res.status(400).json({ error: 'trop de répliques' });
    data.favoriteQuotes = favoriteQuotes;
  }
  await db.collection('profiles').doc(req.uid).set(data, { merge: true });
  res.json({ success: true });
});

// Profil public (sans email ni liste d'amis) — pour visualisation par d'autres
app.get('/api/profile-public', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid requis' });
  const doc = await db.collection('profiles').doc(uid).get();
  if (!doc.exists) return res.json({});
  const d = doc.data();
  res.json({
    uid,
    displayName: d.displayName || '',
    photoURL: d.photoURL || '',
    favoriteFilms: d.favoriteFilms || [],
    favoriteActors: d.favoriteActors || [],
    favoriteQuotes: d.favoriteQuotes || [],
    badges: d.badges || [],
  });
});

// Recherche d'utilisateurs par nom
app.get('/api/recherche-utilisateurs', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);
  const snap = await db.collection('profiles').get();
  const results = snap.docs
    .map(doc => ({ uid: doc.id, ...doc.data() }))
    .filter(p => (p.displayName || '').toLowerCase().includes(q))
    .slice(0, 12)
    .map(p => ({
      uid: p.uid,
      displayName: p.displayName || '',
      photoURL: p.photoURL || '',
    }));
  res.json(results);
});

// Liste des amis
app.get('/api/amis', requireAuth, async (req, res) => {
  const doc = await db.collection('profiles').doc(req.uid).get();
  const friendUids = doc.exists ? (doc.data().friends || []) : [];
  if (!friendUids.length) return res.json([]);
  const friends = await Promise.all(friendUids.map(async (fid) => {
    const fdoc = await db.collection('profiles').doc(fid).get();
    if (!fdoc.exists) return null;
    const f = fdoc.data();
    return {
      uid: fid,
      displayName: f.displayName || '',
      photoURL: f.photoURL || '',
    };
  }));
  res.json(friends.filter(Boolean));
});

// Ajouter un ami
app.post('/api/amis', requireAuth, async (req, res) => {
  const { friendUid } = req.body;
  if (!friendUid) return res.status(400).json({ error: 'friendUid requis' });
  if (req.uid === friendUid) return res.status(400).json({ error: 'Pas toi-même' });
  await db.collection('profiles').doc(req.uid).set({
    friends: admin.firestore.FieldValue.arrayUnion(friendUid),
  }, { merge: true });
  res.json({ success: true });
});

// Retirer un ami
app.delete('/api/amis', requireAuth, async (req, res) => {
  const { friendUid } = req.query;
  if (!friendUid) return res.status(400).json({ error: 'friendUid requis' });
  await db.collection('profiles').doc(req.uid).set({
    friends: admin.firestore.FieldValue.arrayRemove(friendUid),
  }, { merge: true });
  res.json({ success: true });
});

app.get('/scan-page/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

app.get('/scanner', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

app.get('/profil', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profil.html'));
});

app.get('/u/:uid', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'public-profile.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/scan-animation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan-animation.html'));
});

app.listen(PORT, () => {
  console.log(`TakeYourTicket tourne sur http://localhost:${PORT}`);
});
